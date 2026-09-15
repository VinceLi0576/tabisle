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
    // 🔴 260915 去掉秒：每秒重绘一次，而没人盯着秒看。跳秒还会让整页每秒发生一次布局计算。
    $('#clock-time').textContent = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('#clock-date').textContent = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const w = isoWeek(d); const doy = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1;
    $('#clock-week').textContent = `第 ${w.week} 周 / 全年 ${w.total} 周 · 第 ${doy} 天`;
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
