#!/bin/bash

# --- 設定 ---
INPUT_DIR="dist"                  # process_n13_data.py の出力先
OUTPUT_FILE="public/data/japan_roads.pmtiles"
LAYER_NAME="roads"
TEMP_COMBINED="temp_all_prefectures.json"

echo "Starting PMTiles generation..."

# 1. 47都道府県のGeoJSONファイルを1つにまとめる（またはtippecanoeに一括で渡す準備）
# ファイル数が多いので、引数として一括で渡す方法をとります
INPUT_FILES=$(ls ${INPUT_DIR}/processed_*.geojson)

if [ -z "$INPUT_FILES" ]; then
    echo "Error: No input GeoJSON files found in ${INPUT_DIR}"
    exit 1
fi

# 2. tippecanoe によるビルド
# オプション解説:
# -o: 出力ファイル
# -z14: 最大ズームレベル14（道路地図として十分な精度）
# -Z5: 最小ズームレベル5（全国俯瞰）
# --layer: ベクタータイル内のレイヤー名
# --force: 既存ファイルを上書き
# --drop-densest-as-needed: 容量制限内に収まるよう、密集したデータを自動で間引く
# --extend-zooms-if-still-dropping: データ量が多い場合にズームレベルを自動延長
# --read-parallel: 並列読み込みで高速化

tippecanoe -o $OUTPUT_FILE \
    --name "Motorcycle Road Network Japan" \
    --layer $LAYER_NAME \
    --minimum-zoom=5 \
    --maximum-zoom=14 \
    --force \
    --read-parallel \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    --convert-count=width \
    --description "Road data for motorcycles based on MLIT N13" \
    --rules='[
        { "filter": ["any", ["==", "type", 1], ["==", "type", 2]], "minzoom": 5 },
        { "filter": ["==", "type", 3], "minzoom": 8 },
        { "filter": ["any", ["==", "type", 4], ["==", "type", 5]], "minzoom": 11 },
        { "filter": ["all"], "minzoom": 13 }
    ]' \
    $INPUT_FILES

# 3. ビルド結果の確認
if [ -f "$OUTPUT_FILE" ]; then
    echo "Successfully generated: $OUTPUT_FILE"
    # ファイルサイズを表示
    ls -lh $OUTPUT_FILE
else
    echo "Error: PMTiles generation failed."
    exit 1
fi