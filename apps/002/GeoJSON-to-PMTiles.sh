# GeoJSONをPMTilesに変換する例 (tippecanoeを使用)
# -名: 道路名, -自: 自動車専用道路フラグ 等を属性に含める
tippecanoe -o road_centerline.pmtiles -zg --drop-rate 0 --force road_n13.geojson
