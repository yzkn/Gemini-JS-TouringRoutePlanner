import React, { useState, useEffect, useRef, useCallback } from 'react';
import Map, { Source, Layer, MapLayerMouseEvent, Marker, NavigationControl, useControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { Protocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';
import LZString from 'lz-string';

import ElevationChart from './ElevationChart';
import { analyzeRouteElevation } from './ElevationService'; // 前ステップで作成した関数


// --- 設定 ---
const GSI_PALE_TILE = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ELEVATION_TILE = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
const ROAD_PMTILES_URL = "https://your-server.com/road_centerline.pmtiles"; // 作成したPMTilesのURL

const App = () => {
    const [points, setPoints] = useState<any[]>([]); // 経由点
    const [routeGeoJSON, setRouteGeoJSON] = useState<any>(turf.featureCollection([]));
    const [isRoadMode, setIsRoadMode] = useState(true);
    const [history, setHistory] = useState<any[][]>([]);
    const [totalStats, setTotalStats] = useState({ distance: 0, gain: 0 });

    const [routeProfile, setRouteProfile] = useState<any[]>([]);
    const [hoverCoords, setHoverCoords] = useState<number[] | null>(null);

    // PMTilesプロトコルの設定
    useEffect(() => {
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        return () => {
            maplibregl.removeProtocol("pmtiles");
        };
    }, []);

    // 地図クリック時の処理
    const onMapClick = useCallback((e: MapLayerMouseEvent) => {
        const map = e.target;
        let targetPoint = [e.lngLat.lng, e.lngLat.lat];

        if (isRoadMode) {
            // 道路中心線レイヤーから最寄りの地物を取得 (layerIdはPMTiles内のレイヤー名)
            const features = map.queryRenderedFeatures(e.point, { layers: ['road-layer'] });
            if (features.length > 0) {
                const road = features[0];
                const snapped = turf.nearestPointOnLine(road.geometry as any, turf.point(targetPoint));
                targetPoint = snapped.geometry.coordinates;
                // 道路属性（道路名や自専道フラグ）を取得して保存可能
            }
        }

        const newPoints = [...points, targetPoint];
        updateRoute(newPoints);
    }, [points, isRoadMode]);

    // 経路の更新と統計計算
    const updateRoute = async (newPoints: any[]) => {
        setHistory([...history, points]);
        setPoints(newPoints);

        if (newPoints.length < 2) return;

        // LineStringの作成
        const line = turf.lineString(newPoints);
        const distance = turf.length(line, { units: 'kilometers' });

        // 標高計算 (簡易版：サンプリングして標高タイルから取得)
        const elevationGain = await calculateElevationGain(line);

        setRouteGeoJSON(turf.featureCollection([line]));
        setTotalStats({ distance, gain: elevationGain });

        // URLに状態を保存 (lz-string)
        const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(newPoints));
        window.history.replaceState(null, '', `?r=${compressed}`);
    };

    // Undo機能
    const undo = () => {
        if (history.length === 0) return;
        const prev = history[history.length - 1];
        setHistory(history.slice(0, -1));
        setPoints(prev);
        updateRoute(prev);
    };

    // 経路が更新されたときに呼ばれる関数（前ステップのupdateRouteを拡張）
    const onRouteUpdate = async (line: any) => {
        const result = await analyzeRouteElevation(line);
        setRouteProfile(result.profile);
        // ...距離や獲得標高のState更新
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <div style={{ flex: 1, position: 'relative' }}>
                <Map
                    initialViewState={{ longitude: 139.7, latitude: 35.6, zoom: 12 }}
                    mapStyle={{
                        version: 8,
                        sources: {
                            "gsi-pale": { type: "raster", tiles: [GSI_PALE_TILE], tileSize: 256 },
                            "roads": { type: "vector", url: `pmtiles://${ROAD_PMTILES_URL}` }
                        },
                        layers: [
                            { id: "base", type: "raster", source: "gsi-pale" },
                            {
                                id: "road-layer", type: "line", source: "roads", "source-layer": "roads",
                                paint: { "line-color": "rgba(0,0,0,0)", "line-width": 10 } // クリック判定用
                            }
                        ]
                    }}
                    onClick={onMapClick}
                >
                    <Source id="route" type="geojson" data={routeGeoJSON}>
                        <Layer
                            id="route-line"
                            type="line"
                            paint={{
                                "line-color": "#3887be",
                                "line-width": 5,
                                "line-opacity": 0.75
                            }}
                        />
                    </Source>

                    {/* グラフホバー時の連動マーカー */}
                    {hoverCoords && (
                        <Marker longitude={hoverCoords[0]} latitude={hoverCoords[1]}>
                            <div style={{
                                width: 12, height: 12, backgroundColor: 'red',
                                borderRadius: '50%', border: '2px solid white',
                                transform: 'translate(-50%, -50%)'
                            }} />
                        </Marker>
                    )}
                </Map>

                {/* 下部パネル: 断面図 */}
                <div style={{ height: '220px', borderTop: '1px solid #ccc', zIndex: 1000 }}>
                    <ElevationChart
                        profile={routeProfile}
                        onHoverPoint={(coords) => setHoverCoords(coords)}
                    />
                </div>
            </div>
            );
};

            // 標高タイル(PNG)から標高を取得する関数
            async function calculateElevationGain(line: any) {
    // ここで地理院標高タイルのURLをフェッチし、
    // RGB値から標高を算出 (h = 2^16R + 2^8G + B) するロジックを実装
    // 詳細な実装には canvas を使ったピクセル解析が必要
    return 0; // ダミー
}

const exportGeoJSON = () => { /* GeoJSONのダウンロード処理 */};

            const sidebarStyle: React.CSSProperties = {
                position: 'absolute', top: 10, left: 10, zIndex: 100,
            background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
};

            export default App;