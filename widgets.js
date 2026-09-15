// 顶栏小部件：时钟（秒跳、ISO 周数）＋ 天气（浏览器定位 → IP 兜底，Open-Meteo，30 分钟缓存）
(() => {
  const $ = (s) => document.querySelector(s);
  const store = { prefs: { get: (d) => chrome.storage.local.get(d), set: (o) => chrome.storage.local.set(o) } };
  // ── 时间日期 ──
  function isoWeek(d) {
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((x - y0) / 86400000 + 1) / 7);
    const dec28 = new Date(Date.UTC(x.getUTCFullYear(), 11, 28)); const dd = dec28.getUTCDay() || 7; dec28.setUTCDate(dec28.getUTCDate() + 4 - dd);
    const total = Math.ceil(((dec28 - y0) / 86400000 + 1) / 7);
    return { week, total, year: x.getUTCFullYear() };
  }
  function tickClock() {
    const d = new Date();
    // 老徐 260915：「时间我明确要秒，这感觉在动非常好」⇒ 秒留着。
    // （我一度以为是噪音去掉了，他要的就是那个「在动」。）
    $('#clock-time').textContent = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    $('#clock-date').textContent = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const w = isoWeek(d); const doy = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1;
    // 老徐 260915：「倒计时几周几天，过了几天剩下几天」。
    // 🔴 260916 重排：原来四行平铺，而且周数说了两遍（「第 38 周」和「过了 38 周」是同一件事）。
    //   现在去重 —— 上面一行只说「现在是第几周第几天」，下面用一条进度条 ＋ 一行「还剩」。
    const yearDays = ((y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365)(d.getFullYear());
    const leftDays = yearDays - doy;
    const leftWeeks = Math.max(0, w.total - w.week);
    $('#clock-week').textContent = `第 ${w.week} 周 · 第 ${doy} 天 · 还剩 ${leftDays} 天`;

    // 老徐 260916：「加个进度条之类的显示就更好了，一年的、一个季度的、一个月的、一周的」
    const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate();
    const qStart = new Date(y, Math.floor(mo / 3) * 3, 1);
    const qEnd = new Date(y, Math.floor(mo / 3) * 3 + 3, 0);
    const qDays = Math.round((qEnd - qStart) / 864e5) + 1;
    const qDone = Math.round((d - qStart) / 864e5) + 1;
    const mDays = new Date(y, mo + 1, 0).getDate();
    const wDay = (d.getDay() + 6) % 7 + 1;          // 周一算第 1 天
    const rows = [
      ['年', doy, yearDays, `${y} 年`],
      ['季', qDone, qDays, `第 ${Math.floor(mo / 3) + 1} 季度`],
      ['月', day, mDays, `${mo + 1} 月`],
      ['周', wDay, 7, `第 ${w.week} 周`],
    ];
    const box = $('#clock-bars');
    if (box) {
      const html = rows.map(([label, done, total, name]) => {
        const p = Math.min(100, Math.max(0, (done / total) * 100));
        const title = `${name}：过了 ${done} / ${total} 天，还剩 ${total - done} 天`;
        return `<span class="sf-row" title="${title}"><b>${label}</b>`
          + `<span class="sf-track"><i style="width:${p.toFixed(1)}%"></i></span>`
          + `<u>${Math.round(p)}%</u></span>`;
      }).join('');
      if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
    }
  }
  tickClock(); setInterval(tickClock, 1000);

  // ── 天气：浏览器定位（按附近 Wi-Fi 算）→ 退回 IP 定位；Open-Meteo 免钥匙；30 分钟缓存 ──
  const WMO = { 0: ['☀️', '晴'], 1: ['🌤️', '大部晴'], 2: ['⛅', '多云'], 3: ['☁️', '阴'], 45: ['🌫️', '雾'], 48: ['🌫️', '雾凇'], 51: ['🌦️', '毛毛雨'], 53: ['🌦️', '毛毛雨'], 55: ['🌧️', '毛毛雨'], 61: ['🌧️', '小雨'], 63: ['🌧️', '中雨'], 65: ['🌧️', '大雨'], 66: ['🌧️', '冻雨'], 67: ['🌧️', '冻雨'], 71: ['🌨️', '小雪'], 73: ['🌨️', '中雪'], 75: ['❄️', '大雪'], 77: ['❄️', '雪粒'], 80: ['🌦️', '阵雨'], 81: ['🌧️', '阵雨'], 82: ['⛈️', '强阵雨'], 85: ['🌨️', '阵雪'], 86: ['🌨️', '阵雪'], 95: ['⛈️', '雷雨'], 96: ['⛈️', '雷雨冰雹'], 99: ['⛈️', '雷雨冰雹'] };
  async function locate() {
    const geo = await new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, how: 'wifi' }), () => res(null), { timeout: 6000, maximumAge: 600000 });
    });
    if (geo) return geo;
    try { const r = await (await fetch('https://ipwho.is/')).json(); if (r.success && r.latitude) return { lat: r.latitude, lon: r.longitude, city: r.city, how: 'ip' }; } catch {}
    return null;
  }
  async function loadWeather(force = false) {
    const box = $('#weather');
    try {
      const cached = (await store.prefs.get({ weather: null })).weather;
      if (!force && cached && Date.now() - cached.at < 30 * 60e3) { paintWeather(cached); return; }
      const loc = await locate(); if (!loc) { box.title = '拿不到位置：浏览器定位被拒且 IP 定位失败'; return; }
      const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,apparent_temperature,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`)).json();
      let city = loc.city || '';
      if (!city) { try { const g = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${loc.lat}&longitude=${loc.lon}&localityLanguage=zh`)).json(); city = g.city || g.locality || g.principalSubdivision || ''; } catch {} }
      const data = { at: Date.now(), city, how: loc.how, t: Math.round(w.current.temperature_2m), feel: Math.round(w.current.apparent_temperature), hum: w.current.relative_humidity_2m, code: w.current.weather_code, hi: Math.round(w.daily.temperature_2m_max[0]), lo: Math.round(w.daily.temperature_2m_min[0]) };
      await store.prefs.set({ weather: data }); paintWeather(data);
    } catch (e) { box.title = '天气没拿到：' + (e.message || e); }
  }
  function paintWeather(d) {
    const [ico, name] = WMO[d.code] || ['🌡️', ''];
    $('#w-ico').textContent = ico; $('#w-temp').textContent = `${d.t}°`; $('#w-city').textContent = `${d.city || ''} ${name} ${d.lo}°~${d.hi}°`.trim();
    $('#weather').title = `${d.city || ''} ${name}\n体感 ${d.feel}° · 湿度 ${d.hum}%\n定位：${d.how === 'wifi' ? '浏览器（附近 Wi-Fi）' : '按 IP'} · ${new Date(d.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新，点一下刷新`;
  }
  $('#weather').addEventListener('click', () => loadWeather(true));
  loadWeather();

})();
