import * as turf from '@turf/turf';

// 国土地理院 標高タイル設定
const ELEVATION_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
const ZOOM_LEVEL = 14; // 最も詳細な標高が得られるズームレベル
const TILE_SIZE = 256;

// タイル画像のキャッシュ（同じタイルを何度も取得しないため）
const tileCache: Map<string, ImageData> = new Map();

/**
 * 座標(lng, lat)から標高を取得する
 */
async function getElevation(lng: number, lat: number): Promise<number | null> {
    // 1. 座標をタイル座標 (x, y) とタイル内のピクセル位置 (px, py) に変換
    const x = (lng + 180) / 360 * Math.pow(2, ZOOM_LEVEL);
    const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, ZOOM_LEVEL);

    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const px = Math.floor((x - tileX) * TILE_SIZE);
    const py = Math.floor((y - tileY) * TILE_SIZE);

    const tileUrl = ELEVATION_TILE_URL
        .replace('{z}', ZOOM_LEVEL.toString())
        .replace('{x}', tileX.toString())
        .replace('{y}', tileY.toString());

    try {
        let imageData: ImageData;

        if (tileCache.has(tileUrl)) {
            imageData = tileCache.get(tileUrl)!;
        } else {
            // タイル画像を読み込んでImageDataを取得
            imageData = await fetchTileImageData(tileUrl);
            tileCache.set(tileUrl, imageData);
        }

        // 2. 指定ピクセルのRGB値を取得
        const index = (py * TILE_SIZE + px) * 4;
        const r = imageData.data[index];
        const g = imageData.data[index + 1];
        const b = imageData.data[index + 2];

        // 3. 国土地理院の数式で標高に変換
        // x = 2^16R + 2^8G + B
        // x < 2^23 の場合: h = x * 0.01
        // x = 2^23 の場合: 無効値
        // x > 2^23 の場合: h = (x - 2^24) * 0.01
        let x_val = r * 65536 + g * 256 + b;
        if (x_val === 8388608) return null; // 無効値（海など）
        if (x_val > 8388608) x_val -= 16777216;

        return x_val * 0.01;
    } catch (e) {
        return null;
    }
}

/**
 * 画像URLからImageDataを生成する
 */
async function fetchTileImageData(url: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = TILE_SIZE;
            canvas.height = TILE_SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject();
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE));
        };
        img.onerror = reject;
        img.src = url;
    });
}

/**
 * ルート全体の標高解析を行う
 */
export async function analyzeRouteElevation(line: turf.Feature<turf.LineString>) {
    const distanceKm = turf.length(line, { units: 'kilometers' });
    // 50m間隔、または最大200地点程度でサンプリング
    const step = Math.max(0.05, distanceKm / 200);
    const profile = [];
    let totalGain = 0;
    let prevElevation: number | null = null;

    for (let d = 0; d <= distanceKm; d += step) {
        const point = turf.along(line, d, { units: 'kilometers' });
        const [lng, lat] = point.geometry.coordinates;
        const elevation = await getElevation(lng, lat);

        if (elevation !== null) {
            profile.push({
                distance: d, // スタートからの距離
                elevation: elevation,
                coords: [lng, lat]
            });

            // 獲得標高（登りのみ合算）の計算
            if (prevElevation !== null && elevation > prevElevation) {
                totalGain += (elevation - prevElevation);
            }
            prevElevation = elevation;
        }
    }

    return {
        profile,   // 断面図用データ
        totalGain, // 獲得標高
        distance: distanceKm
    };
}