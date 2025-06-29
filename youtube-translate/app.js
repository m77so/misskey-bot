
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenAI } = require('@google/genai');
// --- 設定の読み込み ---
let secret;
try {
    secret = require('./secret.json');
} catch (e) {
    console.error('Error: secret.json not found. Please create it from secret.default.json');
    process.exit(1);
}

const { MISSKEY_URL, MISSKEY_TOKEN, GEMINI_API_KEY, YOUTUBE_CHANNEL_URL } = secret;
const misskeyApiUrl = `${MISSKEY_URL}/api/notes/create`;

// --- 処理済み動画リストの読み込み ---
const PROCESSED_VIDEOS_PATH = './processed_videos.json';
let processedVideoIds = [];

async function loadProcessedVideos() {
    try {
        const data = await fs.readFile(PROCESSED_VIDEOS_PATH, 'utf8');
        processedVideoIds = JSON.parse(data);
    } catch (e) {
        if (e.code === 'ENOENT') {
            // ファイルが存在しない場合は初期化
            await saveProcessedVideos();
        } else {
            console.error('Error loading processed videos:', e);
        }
    }
}

async function saveProcessedVideos() {
    try {
        await fs.writeFile(PROCESSED_VIDEOS_PATH, JSON.stringify(processedVideoIds, null, 2));
    } catch (e) {
        console.error('Error saving processed videos:', e);
    }
}

// --- YouTubeから最新のショート動画URLを取得 ---
async function getLatestShortVideoUrl() {
    try {
        const { data } = await axios.get(YOUTUBE_CHANNEL_URL);
        const $ = cheerio.load(data);

        // ytInitialData を抽出
        let ytInitialData = null;
        $('script').each((i, elem) => {
            const scriptContent = $(elem).html();
            if (scriptContent && scriptContent.includes('ytInitialData')) {
                // ytInitialData の部分だけを抜き出す
                const match = scriptContent.match(/var ytInitialData = (.*?);/);
                if (match && match[1]) {
                    try {
                        ytInitialData = JSON.parse(match[1]);
                    } catch (e) {
                        console.error('Error parsing ytInitialData:', e);
                    }
                }
            }
        });

        if (ytInitialData) {
            const shortsTab = ytInitialData.contents.twoColumnBrowseResultsRenderer.tabs.find(tab => tab.tabRenderer && tab.tabRenderer.title === 'ショート');
            if (shortsTab && shortsTab.tabRenderer.content.richGridRenderer) {
                const contents = shortsTab.tabRenderer.content.richGridRenderer.contents;
                for (const item of contents) {
                    const videoId = item.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
                    if (videoId && !processedVideoIds.includes(videoId)) {
                        return { url: `https://www.youtube.com/shorts/${videoId}`, id: videoId };
                    }
                }
            }
        }

        return null; // 新しい動画がないか、データが見つからない
    } catch (error) {
        console.error('Error fetching or parsing YouTube channel page:', error);
        return null;
    }
}


async function generateContentWithGemini(videoUrl) {

    
const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});



    // プロンプトの指示部分を定義
    const instruction_prompt = [
        'あなたは、英語のYouTube動画を日本の視聴者向けに解説する専門家です。以下のYouTubeショート動画を解析し、指定のフォーマットで解説文を作成してください。',
        '',
        '# 作成フォーマット',
        '```',
        '**[動画タイトル]**',
        '',
        '**📝 逐語訳**',
        '[動画内で話されている、または映像として表示されている英語テキストを、タイムスタンプ付きで全て書き出し、その下に自然な日本語訳を併記してください。]',
        '例:',
        '00:01 WA means JAPAN!',
        '00:01 和は日本という意味！',
        '',
        '**💡 文化的な背景の解説**',
        '[この動画で語られている内容や使用されているスラング、ミームなどが、英語圏の文化に詳しくない日本人には理解が難しい場合があります。そのような点について、文化的背景や元ネタを優しく補足解説してください。もし、特に補足することがない場合は、「特にありません。」と記述してください。]',
        '```',
        '',
        '# 注意事項',
        '- 逐語訳は、動画内のテキストを可能な限り正確に、出現する時間（タイムスタンプ）と共に書き出してください。',
        '- 解説は、元の動画の意図を尊重し、中立的かつ客観的に記述してください。',
        '- あなた自身の意見や感想は含めないでください。',
        '- VTuberについては既知なので解説不要です。また、逐語訳も含めて２８００文字以内に収めてください。'
    ].join('\n');

    const textPart = {
        text: instruction_prompt,
    };

    // YouTubeのURLを直接渡すためのPart
    const videoFilePart = {
        fileData: {
          mimeType: "video/mp4",
          fileUri: videoUrl
        },
    };

    // プロンプトのパーツを配列にまとめる
    const promptParts = [textPart, videoFilePart];

    try {


        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptParts
        });

        const text = await response.text;

        console.log('Raw response from Gemini received.');

        // フォーマット抽出ロジック（変更なし）
        const startIndex = text.indexOf('**');
        const endIndex = text.lastIndexOf('```');

        if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
            console.error('Could not find proper format markers in response. Returning full text.');
            return text;
        }

        const formattedText = text.substring(startIndex, endIndex).trim();
        return formattedText;

    } catch (error) {
        console.error('Error generating content with Gemini:');
        // より詳細なエラー情報を表示するように調整
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            if (error.cause) {
                console.error('Cause:', error.cause);
            }
        } else {
            console.error('Error details:', error);
        }
        return null;
    }
}

// --- Misskeyに投稿 ---
async function postToMisskey(content, videoUrl) {
    const text = `${videoUrl}

---
${content}`.trim();

    const data = {
        i: MISSKEY_TOKEN,
        text: text,
        visibility: 'home'
    };
    console.log('Posting to Misskey:', data);
    console.log('Misskey API URL:', misskeyApiUrl);
    try {
        const response = await axios.post(misskeyApiUrl, data, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Successfully posted to Misskey:', response.data);
    } catch (error) {
        console.error('Error posting to Misskey:', error.response ? error.response.data : error.message);
    }
}

// --- メイン処理 ---
(async () => {
    await loadProcessedVideos();

    console.log('Fetching latest short video...');
    const video = await getLatestShortVideoUrl();

    if (video && video.url) {
        console.log(`New video found: ${video.url}`);

        console.log('Generating content with Gemini...');
        const generatedContent = await generateContentWithGemini(video.url);

        if (generatedContent) {
            // Misskeyへの投稿の代わりに、ファイルに出力
            const timestamp = Math.floor(Date.now() / 1000);
            const outputFilename = `output_${timestamp}.txt`;
            const outputContent = `${video.url}

---
${generatedContent}`.trim();
            
            try {
                await fs.writeFile(outputFilename, outputContent, 'utf8');
                console.log(`Content saved to file: ${outputFilename}`);
            } catch (error) {
                console.error('Error saving content to file:', error);
            }

            // Misskeyに投稿
            await postToMisskey(generatedContent, video.url);
            // 処理済みリストに追加して保存
            processedVideoIds.push(video.id);
            await saveProcessedVideos();
            console.log(`Added video ${video.id} to processed list.`);
        } else {
            console.log('Failed to generate content. Skipping post.');
        }
    } else {
        console.log('No new short videos found.');
    }
})();
