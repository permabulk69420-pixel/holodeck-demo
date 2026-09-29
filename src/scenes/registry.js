import { buildCityScene } from './city.js';
import { buildSpaceScene } from './space.js';
import { buildPano, buildLayeredPano } from './pano.js';

// Every scene the picker offers. To add one: drop the image in assets/ and add an entry here.
//   id     unique key (also used by ?room=<id> on desktop)
//   title  / sub   what the picker shows
//   group  for the picker's ordering/grouping
//   build(frame, ref)  returns { content, update }; frame = the scene's front frame in the room
export const SCENES = [
  { id: 'city', group: 'Cities', title: 'Night city', sub: '40th floor, rain · Blender + live 3D',
    build: (frame, ref) => buildCityScene(frame, ref) },
  { id: 'space', group: 'Space', title: 'Space', sub: 'ringed planet · Blender + live 3D',
    build: (frame, ref) => buildSpaceScene(frame, ref) },
  { id: 'sky', group: 'Fantasy', title: 'Sky islands', sub: 'golden hour above the clouds · Blender',
    build: (frame) => buildPano(frame, './assets/sky.jpg') },
  { id: 'celworld', group: 'Fantasy', title: 'Celworld meadow', sub: 'Ghibli-style valley · captured from Celworld',
    build: (frame) => buildPano(frame, './assets/celworld.jpg') },
  { id: 'bridge10', group: 'Spaceship bridge', title: 'Bridge · dark, over the city', sub: 'CC0 pack #10 · original',
    build: (frame) => buildPano(frame, './assets/bridge10.jpg') },
  { id: 'bridge9', group: 'Spaceship bridge', title: 'Bridge · white, above clouds', sub: 'CC0 pack #9 · original',
    build: (frame) => buildPano(frame, './assets/bridge9.jpg') },
  { id: 'bridge8p', group: 'Spaceship bridge', title: 'Bridge · over the ringed planet', sub: 'CC0 pack #8 · windows show Space',
    build: (frame) => buildLayeredPano(frame, './assets/bridge8p.webp', './assets/space.jpg', 0) },
  { id: 'bridge7p', group: 'Spaceship bridge', title: 'Bridge · over the sky islands', sub: 'CC0 pack #7 · windows show Sky islands',
    build: (frame) => buildLayeredPano(frame, './assets/bridge7p.webp', './assets/sky.jpg', 0) },
];
