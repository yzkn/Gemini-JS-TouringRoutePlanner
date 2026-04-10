/**
 * Motorcycle Route Planner - Main Application Logic
 */

// --- 状態管理 ---
let waypoints = []; // {id, marker, coords}
let currentDisplacement = 400;
let isAllowNarrow = false;
const PMTILES_URL = "data/japan_roads.pmtiles";

// --- マップ初期設定 ---
let protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tile.openstreetmap.jp/styles/osm-bright-ja/style.json',
    center: [139.14, 35.45],
    zoom: 11
});

// --- 初期化処理 ---
map.on('load', () => {
    setupMapLayers();
    setupEventListeners();
});

/**
 * レイヤー・ソースの設定
 */
function setupMapLayers() {
    map.addSource('bike-roads', {
        type: 'vector',
        url: `pmtiles://${location.origin}/${PMTILES_URL}`
    });

    // 判定・吸着用（透明）
    map.addLayer({
        'id': 'road-ref',
        'type': 'line',
        'source': 'bike-roads',
        'source-layer': 'roads',
        'paint': { 'line-width': 15, 'line-color': 'rgba(0,0,0,0)' }
    });

    // 視覚用（規制・勾配表示）
    map.addLayer({
        'id': 'road-viz',
        'type': 'line',
        'source': 'bike-roads',
        'source-layer': 'roads',
        'paint': {
            'line-color': [
                'case',
                ['==', ['get', 'limit'], 1], '#ff4444', // 二輪禁止
                ['>', ['get', 'grad'], 15], '#ffa500',  // 激坂
                '#888'
            ],
            'line-width': 2,
            'line-opacity': 0.4
        }
    });

    // 走行経路表示用
    map.addSource('route-path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        'id': 'route-line',
        'type': 'line',
        'source': 'route-path',
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': { 'line-color': '#0070f3', 'line-width': 6, 'line-opacity': 0.8 }
    });
}

/**
 * イベントリスナーの設定
 */
function setupEventListeners() {
    // 地図クリック
    map.on('click', (e) => {
        const snapped = getSmartSnappedPoint(e.lngLat);
        // 吸着しなくてもクリック地点を優先して追加（RideWithGPS方式）
        addWaypoint(snapped || [e.lngLat.lng, e.lngLat.lat]);
    });

    // 排気量切替
    document.querySelectorAll('input[name="cc"]').forEach(el => {
        el.addEventListener('change', (e) => {
            currentDisplacement = parseInt(e.target.value);
            updateRoute(); // 設定変更時に経路を再診断
        });
    });

    // 狭小路許可切替
    document.getElementById('allowNarrow').addEventListener('change', (e) => {
        isAllowNarrow = e.target.checked;
        updateRoute();
    });
}

/**
 * ウェイポイント（経由地）の追加
 */
function addWaypoint(coords) {
    const id = Date.now();
    const el = document.createElement('div');
    el.className = 'marker-num';
    el.innerHTML = waypoints.length + 1;

    const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(coords)
        .addTo(map);

    // ドラッグ中の挙動
    marker.on('dragend', () => {
        const currentLngLat = marker.getLngLat();
        const resnapped = getSmartSnappedPoint(currentLngLat);
        const finalCoords = resnapped || [currentLngLat.lng, currentLngLat.lat];

        marker.setLngLat(finalCoords);
        const wp = waypoints.find(w => w.id === id);
        wp.coords = finalCoords;
        updateRoute();
    });

    waypoints.push({ id, marker, coords });
    updateRoute();
}

/**
 * スマート吸着ロジック
 * 現在の設定（排気量・幅員）に合う最も近い道路を返す
 */
function getSmartSnappedPoint(lngLat) {
    const point = map.project(lngLat);
    const features = map.queryRenderedFeatures([
        [point.x - 15, point.y - 15],
        [point.x + 15, point.y + 15]
    ], { layers: ['road-ref'] });

    if (features.length === 0) return null;

    // 現在の制約でフィルタリング
    const validRoads = features.filter(f => {
        const p = f.properties;
        if (p.limit === 1) return false; // 二輪禁止
        if (currentDisplacement <= 125 && p.m_way === 1) return false; // 125cc高速不可
        if (!isAllowNarrow && p.width === 1) return false; // 狭小路不可
        return true;
    });

    if (validRoads.length === 0) return null;

    // Turf.jsで線上の最近傍点を計算
    const clickedPoint = turf.point([lngLat.lng, lngLat.lat]);
    const snapped = turf.nearestPointOnLine(validRoads[0], clickedPoint);
    return snapped.geometry.coordinates;
}

/**
 * 経路取得と診断の実行
 */
async function updateRoute() {
    if (waypoints.length < 2) return;

    const coordsStr = waypoints.map(w => `${w.coords[0]},${w.coords[1]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?geometries=geojson&overview=full`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.code !== 'Ok') return;

        const route = data.routes[0];

        // 地図に描画
        map.getSource('route-path').setData({
            type: 'Feature',
            geometry: route.geometry
        });

        // 経路診断（以前のanalyzer.js相当の処理を統合）
        runRouteAnalysis(route);

    } catch (err) {
        console.error("OSRM Fetch Error:", err);
    }
}

/**
 * 経路診断（急勾配・規制のチェック）
 */
function runRouteAnalysis(route) {
    const info = document.getElementById('info');
    info.style.display = 'block';

    const dist = (route.distance / 1000).toFixed(1);
    const dur = Math.round(route.duration / 60);

    // PMTilesレイヤーから経路周辺の情報をクエリして診断
    const bbox = turf.bbox(route.geometry);
    const sw = map.project([bbox[0], bbox[1]]);
    const ne = map.project([bbox[2], bbox[3]]);
    const roadFeatures = map.queryRenderedFeatures([sw, ne], { layers: ['road-ref'] });

    const hasSteep = roadFeatures.some(f => f.properties.grad > 15);
    const hasProhibited = roadFeatures.some(f => f.properties.limit === 1);

    let statusHtml = `<strong>距離: ${dist} km / 時間: ${dur} 分</strong><br>`;

    if (hasProhibited) {
        statusHtml += `<span class="alert">⚠️ 経路内に二輪禁止区間が含まれている可能性があります</span>`;
    } else if (hasSteep) {
        statusHtml += `<span class="alert" style="color:orange;">⚠️ 15%超の急勾配（激坂）が含まれています</span>`;
    } else {
        statusHtml += `<span class="safe">✅ ルート診断：大型バイク走行適正 良好</span>`;
    }

    info.innerHTML = statusHtml;
}

/**
 * リセット機能
 */
window.clearAll = function () {
    waypoints.forEach(w => w.marker.remove());
    waypoints = [];
    map.getSource('route-path').setData({ type: 'FeatureCollection', features: [] });
    document.getElementById('info').style.display = 'none';
};