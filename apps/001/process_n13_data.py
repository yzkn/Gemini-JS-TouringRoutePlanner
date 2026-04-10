import geopandas as gpd
import pandas as pd
import requests
import json
import time
import math
import sys
import os
from shapely.geometry import Point

# --- 設定 ---
GSI_ELEVATION_API = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php"
# 15% 以上の勾配をフラグ立てする閾値
STEEP_THRESHOLD = 15.0

def get_elevation(lat, lon):
    """
    国土地理院APIを使用して特定の地点の標高を取得する。
    ※本番環境（全国処理）では大量のリクエストを送るため、
    地理院の標高タイル（画像）をローカルで解析する手法への切り替えを推奨します。
    """
    try:
        params = {'lon': lon, 'lat': lat, 'outtype': 'json'}
        res = requests.get(GSI_ELEVATION_API, params=params, timeout=5)
        if res.status_code == 200:
            return res.json()['elevation']
    except Exception as e:
        print(f"Elevation API error: {e}")
    return 0

def calculate_gradient(row):
    """
    道路リンクの始点と終点の標高差から平均勾配(%)を計算する。
    """
    geom = row.geometry
    if geom.geom_type != 'LineString':
        return 0.0

    # 距離(m)
    # N13は通常 JGD2011 (EPSG:6668) なので、距離計算のために平面直角座標系に一時変換
    length = row['length_m']

    if length == 0:
        return 0.0

    # 始点と終点の座標
    start_lon, start_lat = geom.coords[0]
    end_lon, end_lat = geom.coords[-1]

    # 標高取得
    # ※API負荷軽減のため、本来はキャッシュやタイル処理が必要
    start_alt = get_elevation(start_lat, start_lon)
    end_alt = get_elevation(end_lat, end_lon)

    # 勾配算出: (垂直移動距離 / 水平移動距離) * 100
    elevation_diff = abs(start_alt - end_alt)
    gradient = (elevation_diff / length) * 100
    return round(gradient, 2)

def process_prefecture(pref_code, input_path, regulations_path):
    print(f"Processing Prefecture: {pref_code}...")

    # 1. 道路データの読み込み
    gdf = gpd.read_file(input_path, encoding='cp932')

    # 距離計算用に投影座標系(Webメルカトル等)へ一時変換して長さを算出
    gdf_projected = gdf.to_crs(epsg=3857)
    gdf['length_m'] = gdf_projected.geometry.length

    # 2. 規制データ(regulations.json)の読み込み
    with open(regulations_path, 'r', encoding='utf-8') as f:
        reg_data = json.load(f)

    # 通報地点をPointオブジェクトに変換してGeoDataFrame化
    reg_points = []
    for r in reg_data['prohibited_points']:
        reg_points.append({'geometry': Point(r['lon'], r['lat']), 'reg_type': r['type']})
    reg_gdf = gpd.GeoDataFrame(reg_points, crs="EPSG:4326")

    # 3. 属性加工
    def apply_attributes(row):
        # N13_002: 道路区分 (1:高速, 2:国道, 3:都道府県道...)
        road_type = int(row['N13_002']) if row['N13_002'] else 9

        # 125cc以下不可フラグ (高速道路[1]と自動車専用道路[一部]を想定)
        is_motorway = 1 if road_type == 1 else 0

        # 幅員区分 (N13_003)
        # 1: 3.0m未満, 2: 3.0-5.5m...
        width_class = int(row['N13_003']) if row['N13_003'] else 9

        # 勾配の計算 (※プロトタイプ用。全件回すと時間がかかるため上位道路に絞る等の制限が必要)
        # gradient = calculate_gradient(row)
        gradient = 0.0 # 初期値

        return pd.Series([road_type, is_motorway, width_class, gradient])

    print("Mapping attributes...")
    gdf[['road_type', 'is_motorway', 'width_class', 'grad']] = gdf.apply(apply_attributes, axis=1)

    # 4. 規制データの空間結合 (付近を通るリンクに規制フラグを立てる)
    # 道路リンクの周囲10mに規制通報点があるか判定
    gdf['limit'] = 0
    joined = gpd.sjoin_nearest(gdf, reg_gdf.to_crs(gdf.crs), max_distance=0.0001) # 約10m
    gdf.loc[joined.index, 'limit'] = 1

    # 5. 軽量化: 必要なカラムのみ抽出
    # tippecanoeでの属性参照を短くするため、短い名前に変更
    out_gdf = gdf[['geometry', 'N13_001', 'road_type', 'is_motorway', 'width_class', 'grad', 'limit']]
    out_gdf.columns = ['geometry', 'name', 'type', 'm_way', 'width', 'grad', 'limit']

    # 6. 保存
    output_filename = f"dist/processed_{pref_code}.geojson"
    os.makedirs("dist", exist_ok=True)
    out_gdf.to_file(output_filename, driver='GeoJSON')
    print(f"Saved: {output_filename}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python process_n13_data.py [pref_code] [input_shapefile_path]")
    else:
        # 実行例: python process_n13_data.py 14 data/N13-24_14.shp
        process_prefecture(sys.argv[1], sys.argv[2], "regulations.json")
