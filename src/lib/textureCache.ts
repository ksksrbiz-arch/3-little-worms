import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();

export function getCachedTexture(url: string, configure?: (texture: THREE.Texture) => void) {
  const cached = textures.get(url);
  if (cached) return cached;

  const texture = textureLoader.load(url);
  configure?.(texture);
  textures.set(url, texture);
  return texture;
}
