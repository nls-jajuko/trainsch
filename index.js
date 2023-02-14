import 'ol/ol.css';
import apply from 'ol-mapbox-style';
import Map from 'ol/Map';
import Hash from './hash';
import featuresStyle from './data/style.json';
import GeoJSON from 'ol/format/GeoJSON';
import { easeOut, linear } from 'ol/easing.js';
import { fromLonLat } from 'ol/proj.js';
import { getVectorContext } from 'ol/render.js';
import { unByKey } from 'ol/Observable.js';
import { Circle as CircleStyle, Stroke, Style } from 'ol/style.js';
import { Quaternion, Vector3 } from '@math.gl/core';
import { LineString } from 'ol/geom';

import { transform } from 'ol/proj';

const hash = new Hash(),
  map = new Map({ target: 'map' }),
  format = new GeoJSON({
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326'
  });
hash.addTo(map);

const featCache = {};

const batchSize = 500,
  colls = [
    {
      api: 'v1', url: 'https://rata.digitraffic.fi/api/v1/train-locations.geojson/latest',
      featType: 'train-locations'
    }
  ];

const duration = 4000;

function lerp(p, q, time) {
  return (1.0 - time) * p + time * q;
};

const lerpStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    stroke: new Stroke({
      color: 'rgba(255,0,0,1.0)',
      width: 3,
    }),
  }),
});

const lineStyle =
  new Style({
    stroke: new Stroke({
      color: 'rgba(255,0,0,1.0)',
      width: 3
    }),
  })
  ;


function flash(tileLayer, feature) {
  const start = Date.now();
  const listenerKey = tileLayer.on('postrender', animate);

  function animate(event) {
    const flashGeom = feature.getGeometry().clone();
    const frameState = event.frameState;
    const elapsed = frameState.time - start;
    if (elapsed >= duration) {
      unByKey(listenerKey);
      return;
    }
    const vectorContext = getVectorContext(event);
    const elapsedRatio = elapsed / duration;
    // radius will be 5 at start and 30 at end.
    const radius = easeOut(elapsedRatio) * 25 + 5;
    const opacity = easeOut(1 - elapsedRatio);
    const linearEased = linear(elapsedRatio);

    let loc = flashGeom.getCoordinates(),
      prev_loc = feature.get('prev_loc') || loc,
      x1 = prev_loc[0], y1 = prev_loc[1],
      x2 = loc[0], y2 = loc[1];

    const kmInHspeed = feature.getProperties()['speed'],
      mPerMSec = kmInHspeed * 1000 / 3600 / 1000,
      mPerEase = mPerMSec * elapsedRatio * duration;

    let x3 = lerp(x1, x2, elapsedRatio), y3 = lerp(y1, y2, elapsedRatio);



    const style = new Style({
      image: new CircleStyle({
        radius: radius,
        stroke: new Stroke({
          color: 'rgba(255, 0, 0, ' + opacity + ')',
          width: 0.25 + opacity,
        }),
      }),
    });

    vectorContext.setStyle(style);
    flashGeom.setCoordinates([x1, y1]);
    vectorContext.drawGeometry(flashGeom);

    vectorContext.setStyle(lerpStyle);
    flashGeom.setCoordinates([x3, y3]);
    vectorContext.drawGeometry(flashGeom);

    let trailing = feature.get('trailing');
    if (trailing && trailing.length > 1) {


      const lineGeom = new LineString(trailing);

      vectorContext.setStyle(lineStyle);
      vectorContext.drawGeometry(lineGeom);
    }
    // tell OpenLayers to continue postrender animation
    map.render();
  }
}

function fetchFeats(layer, source, bounds) {
  const
    lb = transform([bounds[0], bounds[1]], 'EPSG:3857', 'EPSG:4326'),
    rt = transform([bounds[2], bounds[3]], 'EPSG:3857', 'EPSG:4326'),
    bbox = [lb[0], lb[1], rt[0], rt[1]];

  
  colls.forEach(coll => {
    const api = coll.api, featType = coll.featType, url = coll.url;

    features((fc) => {
      const feats = format.readFeatures(fc),
        featsToAdd = [];
      feats.forEach(f => {
        f.setId(api + "_" + f.getProperties()['trainNumber']);

        const known = featCache[f.getId()];
        if (known) {
          let knownGeom = known.getGeometry();

          let trailing = known.get('trailing');
          trailing.push(knownGeom.getCoordinates());
          if (trailing.length > 5) {
            trailing.unshift();
          }

          known.set('prev_loc', knownGeom.getCoordinates().slice(0), true);
          knownGeom.setCoordinates(f.getGeometry().getCoordinates().slice(0));
          flash(layer, known);
        } else {
          f.set('prev_loc', f.getGeometry().getCoordinates().slice(0), true);
          f.set('trailing', [f.getGeometry().getCoordinates()], true);

          featsToAdd.push(f);
          featCache[f.getId()] = f;

        }
      }
      );
      if (featsToAdd.length) {
        source.addFeatures(featsToAdd);
      }
      const extent = source.getExtent();
      return true;
    }, url, featType, {
      bbox: bbox.join(',')
    });
  });


}

apply(
  map, featuresStyle).then(function (map) {

    const view = map.getView(),
      layer = map.getLayers().getArray()[2],
      source = layer.getSource();



    source.on('addfeature', function (e) {
      //flash(layer,e.feature);
    });

    map.on("moveend", (evt) => {

      const bounds = view.calculateExtent(map.getSize());

      fetchFeats(layer, source, bounds);

    });

    setInterval(() => {

      const bounds = view.calculateExtent(map.getSize());

      fetchFeats(layer, source, bounds);
    }, duration);
  });



map.on('click', (evt) => {
  document.getElementById('info').innerHTML = '';
  map.forEachFeatureAtPixel(evt.pixel, (f) => {
    const json = { ...f.getProperties() };
    json.geometry = null;
    document.getElementById('info').innerHTML += JSON.stringify(json, undefined, 2) + '\n';
  });
});

export async function features(func, endpoint, feat, params) {
  const url = new URL(`${endpoint}`);
  Object.entries(params).forEach((item) => url.searchParams.set(...item));

  for (let next = url.toString(); next; next = await fetch(next).then(r => r.json()).then(json => {
    return (func(json) && json.links) ? json.links.filter(l => l.rel === 'next').map(l => l.href)[0] : 0
  }));
}