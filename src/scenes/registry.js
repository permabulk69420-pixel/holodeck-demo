import { buildCityScene } from './city.js';
import { buildSpaceScene } from './space.js';
import { buildPano, buildLayeredPano } from './pano.js';
import { buildStage } from './stage.js';
import { composeLayers } from './layers.js';

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
  // far panorama (captured from the Oasis game at golden hour, vegetation within 25 m removed)
  // + live near stage: sand floor, GLB plants from the game scattered on it, matched sun.
  // sun.dir = the capture's sun, in the panorama's own frame (x right, y up, -z front).
  { id: 'oasis', group: 'Desert', title: 'Oasis shore', sub: 'golden hour · panorama + live GLB plants',
    build: (frame, ref) => composeLayers(
      buildPano(frame, './assets/oasis.jpg'),
      buildStage(frame, ref, {
        seed: 7,
        floor: { texture: './assets/oasis/sand.jpg', tileMetres: 4, radius: 70, fadeStart: 0.5, tint: [0.7, 0.74, 0.8] },
        sun: { dir: [0.882, 0.156, -0.446], color: 0xffb686, intensity: 2.2 },
        hemi: { sky: 0xc4e1f0, ground: 0x9a7a52, intensity: 1.2 },
        kinds: [
          { url: './assets/oasis/alien_tree.glb', count: 5, scale: [0.9, 1.5], r: [6, 26], foot: 3.0 },
          { url: './assets/oasis/berry_bush.glb', count: 5, scale: [0.8, 1.3], r: [4.5, 22], foot: 2.0 },
          { url: './assets/oasis/alien_plant.glb', count: 5, scale: [0.8, 1.2], r: [5, 24], foot: 3.0 },
          { url: './assets/oasis/green_fern.glb', count: 12, scale: [0.8, 1.5], r: [3.5, 20], foot: 2.0 },
          { url: './assets/oasis/purple_fern.glb', count: 2, scale: [0.35, 0.5], r: [8, 24], foot: 7.4 },
        ],
      }),
    ) },
];
