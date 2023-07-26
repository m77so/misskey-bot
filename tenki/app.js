const axios = require('axios');
const sec = require('./secret.json')
const w = require('./w.json')
const token = sec['token']
const domain = sec['domain']
const url = `https://${domain}/api/notes/create`; 
(async () => {
    const target_areas = [
        "札幌", "仙台", "東京", "大阪", "福岡"
    ]
    const target_date = (()=>{
        const t = new Date()
        const jst = new Date(+t + 9 * 60 * 60 * 1000)
        const h = jst.getUTCHours()
        // 17時以降は明日の予報が見たい
        const target = h >= 17 ? new Date(+jst + 86400 * 1000) : jst
        return target.toISOString().slice(0,10)
    })()
    const target_time = target_date + 'T00:00:00+09:00'
    const target_temp_time = target_date + 'T09:00:00+09:00'
    const f = await axios.get('https://www.jma.go.jp/bosai/forecast/data/forecast/010000.json')
    const areas = f.data.map(v=>v.name)
    const res = {}
    let report_time = null
    for (let target_area of target_areas) {
        const area_index = areas.indexOf(target_area)
        if (report_time === null) report_time = f.data[area_index]["srf"]["reportDatetime"].slice(0,19)
        let t = f.data[area_index]["srf"]["timeSeries"][0]["timeDefines"].indexOf(target_time)
        if (t === -1) return 1
        const wcode = f.data[area_index]["srf"]["timeSeries"][0]["areas"]["weatherCodes"][t]
        t = f.data[area_index]["srf"]["timeSeries"][2]["timeDefines"].indexOf(target_temp_time)
        const temp = f.data[area_index]["srf"]["timeSeries"][2]["areas"]["temps"][t]
        res[target_area] = { "emoji": w[wcode]["emoji"], temp}
    }

const txt = `$[fg.color=faa $[bg.color=000 試験運用中]]
$[position.x=12,y=10 $[scale.x=3,y=3 $[scale.x=5,y=5 🗾 ]]]
$[position.x=11,y=11 $[fg.color=fff 東京]
$[fg.color=f22 ${res['東京']['temp']}]$[fg.color=fff ${res['東京']['emoji']}]]
$[position.x=6.5,y=8 $[fg.color=fff 大阪]
$[fg.color=f22 ${res['大阪']['temp']}]$[fg.color=fff ${res['大阪']['emoji']}]]
$[position.x=1,y=7 $[fg.color=fff 福岡]
$[fg.color=f22 ${res['福岡']['temp']}]$[fg.color=fff ${res['福岡']['emoji']}]]
$[position.x=10,y=-6 $[fg.color=fff 札幌]
$[fg.color=f22 ${res['札幌']['temp']}]$[fg.color=fff ${res['札幌']['emoji']}]]
$[position.x=11,y=-3 $[fg.color=fff 仙台]
$[fg.color=f22 ${res['仙台']['temp']}]$[fg.color=fff ${res['仙台']['emoji']}]]
$[position.y=-11 $[bg.color=ccc $[fg.color=111 ${target_date.slice(-2)}日の予報
気象庁
${report_time.slice(8,10)}日${report_time.slice(11,13)}時発表]]]

https://www.jma.go.jp/bosai/forecast/`

console.log(txt)
const data = {
      i: token,
      text: txt,
      visibility: 'public'
    };

    axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
    .then((response) => {
      console.log(response.data);
    })
    .catch((error) => {
      console.error(error);
    });
})()
