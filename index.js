import 'ol/ol.css';
import apply from 'ol-mapbox-style';
import Map from 'ol/Map';
import Hash from './hash';
import featuresStyle from './data/style.json';
import GeoJSON from 'ol/format/GeoJSON';

import { features } from './features';
import { transform } from 'ol/proj';

const hash = new Hash(),
  map = new Map({ target: 'map' }),
  format = new GeoJSON({
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326'
  });
hash.addTo(map);

const batchSize = 500,
colls = [
  {
    api: 'v1', url: 'https://beta-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v1',
    featType: 'RajamerkinSijaintitiedot'
  },
  {
    api: 'v1', url: 'https://beta-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v1',
    featType: 'KiinteistorajanSijaintitiedot'
  }
];

apply(
  map, featuresStyle).then(function (map) {

    map.on("moveend", (evt) => {
      const
        view = map.getView(),
        layer = map.getLayers().getArray()[1],
        source = layer.getSource(),
        bounds = view.calculateExtent(map.getSize()),
        lb = transform([bounds[0], bounds[1]], 'EPSG:3857', 'EPSG:4326'),
        rt = transform([bounds[2], bounds[3]], 'EPSG:3857', 'EPSG:4326'),
        bbox = [lb[0], lb[1], rt[0], rt[1]];

     
      source.clear();
      document.getElementById('info').innerHTML = '';

      if (map.getView().getZoom() >= 14) {
        colls.forEach(coll => {
          const api = coll.api, featType = coll.featType, url = coll.url;

          features((fc) => {
            const feats = format.readFeatures(fc);
            console.log(api + ".length" + feats.length);
            feats.forEach(f => {
              f.setId(api + "_" + f.getId());
              f.setProperties({ 'api': api });
            }
            );
            source.addFeatures(feats);
            const extent = source.getExtent();
            return true;
          }, url, featType, {
            limit: batchSize,
            bbox: bbox.join(',')
          });
        });
      }


    });
  });

map.on('click', (evt) => {
  document.getElementById('info').innerHTML = '';
  map.forEachFeatureAtPixel(evt.pixel, (f) => {
    const json = { ...f.getProperties() };
    json.geometry = null;
    document.getElementById('info').innerHTML += JSON.stringify(json, undefined, 2) + '\n';
  });
});


window.map = map;