import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = 'skvizhead-state-v2';
const DEFAULTS = {
  theme: 'dark', sound: true, animations: true, autosave: true, quality: 'auto',
  pose: { x: 0, y: 0, z: 0, scale: 1.2 },
  camera: { distance: 3.2, fov: 35, preset: 'front' },
  background: { type: 'gradient', color1: '#111a35', color2: '#2563eb', angle: 135, preset: 'Ocean' },
  lighting: { ambient: 1.1, main: 2.2, rim: 1.2, rotation: 35, shadow: true, preset: 'studio' },
  export: { resolution: 512, transparent: false, shadow: true, highQuality: true, filename: 'skviz_head.png' }
};
const BG_PRESETS = [
  ['Ocean', '#071c35', '#1384c7', 135], ['Night', '#080b16', '#333658', 145], ['Purple', '#1c1238', '#7a4ff4', 120],
  ['Minecraft', '#264e38', '#7bb54d', 145], ['Nether', '#260b12', '#b52c2c', 125], ['End', '#0d0920', '#563b7e', 145],
  ['Diamond', '#073b4c', '#55d8dc', 155], ['Emerald', '#063b31', '#1cba78', 140], ['Obsidian', '#080812', '#373052', 135], ['Sunset', '#4f1c42', '#ff8a4c', 120]
];
const POSE_PRESETS = { default: [0, 0, 0, 1.2], front: [0, 0, 0, 1.2], hero: [-8, -23, -4, 1.28], profile: [0, 90, 0, 1.2], gaming: [14, -28, 7, 1.17], minimal: [-2, 10, 0, 1.05] };
const LIGHT_PRESETS = {
  studio: [1.1, 2.2, 1.2, 35], soft: [1.5, 1.45, .65, 12], dramatic: [.55, 3.15, 2.6, -42], minecraft: [1.25, 2.4, .4, 28]
};
const CAMERA_PRESETS = {
  front: [0, 0.04, 3.2], threequarter: [2.25, .1, 2.25], side: [3.2, .08, 0], top: [0, 3.15, .45], back: [0, .08, -3.2]
};

let state = loadState();
let skinData = null;
let skinInfo = null;
let rendererState = null;
let history = [];
let historyIndex = -1;
let historyTimer = null;
let saveTimer = null;
let transition = null;
let toastTimer = null;
let audioContext = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mergeState(base, incoming) {
  const out = clone(base);
  for (const key of Object.keys(incoming || {})) out[key] = typeof incoming[key] === 'object' && incoming[key] && !Array.isArray(incoming[key]) ? { ...out[key], ...incoming[key] } : incoming[key];
  return out;
}
function loadState() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); return mergeState(DEFAULTS, saved || {}); } catch { return clone(DEFAULTS); }
}
function persist() {
  if (!state.autosave) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('#saveStatus').innerHTML = '<span class="status-dot"></span>Autosaved'; } catch { $('#saveStatus').innerHTML = '<span class="status-dot" style="background:#f5c768"></span>Session only'; }
}
function scheduleSave() { clearTimeout(saveTimer); $('#saveStatus').innerHTML = '<span class="status-dot" style="background:#f5c768;box-shadow:0 0 10px #f5c768"></span>Saving'; saveTimer = setTimeout(persist, 250); }
function snapshot() { return { pose: clone(state.pose), camera: clone(state.camera), background: clone(state.background), lighting: clone(state.lighting), export: clone(state.export) }; }
function pushHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    const next = snapshot();
    const current = history[historyIndex];
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    history = history.slice(0, historyIndex + 1); history.push(next); historyIndex = history.length - 1;
    if (history.length > 40) { history.shift(); historyIndex -= 1; }
  }, 320);
}
function undo() { if (historyIndex <= 0) return toast('Nothing to undo', 'warn'); historyIndex -= 1; restoreSnapshot(history[historyIndex]); toast('Undid last change'); }
function redo() { if (historyIndex >= history.length - 1) return toast('Nothing to redo', 'warn'); historyIndex += 1; restoreSnapshot(history[historyIndex]); toast('Redid change'); }
function restoreSnapshot(next) { state = mergeState(state, next); syncUI(); renderState(); scheduleSave(); }
function toast(message, type = 'success') {
  const region = $('#toastRegion'); const el = document.createElement('div'); el.className = `toast ${type}`;
  const icon = type === 'error' ? '#i-close' : type === 'warn' ? '#i-help' : '#i-check';
  el.innerHTML = `<svg><use href="${icon}"></use></svg><span>${message}</span>`; region.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 3000);
}
function playSound(kind = 'click') {
  if (!state.sound) return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
    const tones = { click: [380, .035], switch: [520, .05], success: [620, .12], error: [170, .12] }; const [freq, duration] = tones[kind] || tones.click;
    osc.frequency.value = freq; osc.type = 'sine'; gain.gain.setValueAtTime(.0001, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.045, audioContext.currentTime + .008); gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration); osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration + .02);
  } catch { /* audio is optional */ }
}
function sanitizeFilename(value) { return (value || 'skviz_head').trim().replace(/[^a-z0-9 _.-]/gi, '_').replace(/\.png$/i, '') || 'skviz_head'; }
function hex(value) { return value.toUpperCase(); }

function initRenderer() {
  const container = $('#rendererContainer');
  try {
    rendererState = {};
    const scene = new THREE.Scene();
    const bgScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(state.camera.fov, 1, .1, 100);
    camera.position.set(0, .04, state.camera.distance);
    const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(getPixelRatio()); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.setClearColor(0x000000, 0); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .075; controls.enablePan = false; controls.minDistance = 1.7; controls.maxDistance = 6; controls.target.set(0, 0, 0); controls.addEventListener('start', () => { transition = null; });
    const headGroup = new THREE.Group(); headGroup.position.y = .05; scene.add(headGroup);
    const ambient = new THREE.AmbientLight(0xffffff, state.lighting.ambient);
    const key = new THREE.DirectionalLight(0xffffff, state.lighting.main); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = .1; key.shadow.camera.far = 12; key.shadow.bias = -.0005;
    const rim = new THREE.DirectionalLight(0x8abaff, state.lighting.rim);
    const fill = new THREE.HemisphereLight(0x9ccaff, 0x161a29, .35);
    scene.add(ambient, key, rim, fill);
    const shadow = createShadowMesh(); scene.add(shadow);
    const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false })); bgScene.add(bgPlane);
    rendererState = { container, scene, bgScene, camera, bgCamera, renderer, controls, headGroup, ambient, key, rim, fill, shadow, bgPlane, baseMesh: null, overlayMesh: null, frame: 0, visible: true };
    resizeRenderer(); updateBackground(); updateLighting(); updatePose();
    new ResizeObserver(resizeRenderer).observe(container);
    window.addEventListener('resize', resizeRenderer, { passive: true }); document.addEventListener('visibilitychange', () => { rendererState.visible = !document.hidden; });
    $('#canvasLoading').classList.add('hidden');
    animate();
  } catch (error) {
    $('#canvasLoading').innerHTML = '<strong>3D Preview Unavailable</strong><span>Your browser does not support the required WebGL features.</span>'; toast('WebGL is unavailable in this browser', 'error');
  }
}
function getPixelRatio() { const quality = state.quality; if (quality === 'performance') return 1; if (quality === 'high') return Math.min(window.devicePixelRatio || 1, 2); return Math.min(window.devicePixelRatio || 1, 1.7); }
function resizeRenderer() { if (!rendererState) return; const { container, renderer, camera } = rendererState; const width = Math.max(1, container.clientWidth); const height = Math.max(1, container.clientHeight); renderer.setPixelRatio(getPixelRatio()); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
function createShadowMesh() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d'); const gradient = ctx.createRadialGradient(128,128,8,128,128,112); gradient.addColorStop(0, 'rgba(0,0,0,.42)'); gradient.addColorStop(.55, 'rgba(0,0,0,.16)'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gradient; ctx.fillRect(0,0,256,256); const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1.15), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })); mesh.rotation.x = -Math.PI / 2; mesh.position.y = -.78; mesh.position.z = .12; return mesh;
}
function animate() { if (!rendererState) return; requestAnimationFrame(animate); if (!rendererState.visible) return; if (transition) updateCameraTransition(); rendererState.controls.update(); renderFrame(); }
function renderFrame() { const { renderer, bgScene, bgCamera, scene, camera } = rendererState; renderer.autoClear = true; renderer.render(bgScene, bgCamera); renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true; }
function updateCameraTransition() {
  const t = rendererState.camera; const now = performance.now(); const p = Math.min(1, (now - transition.started) / transition.duration); const eased = 1 - Math.pow(1 - p, 3); t.camera.position.lerpVectors(transition.fromPos, transition.toPos, eased); t.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased); if (p >= 1) transition = null;
}
function transitionCamera(preset) { if (!rendererState || !CAMERA_PRESETS[preset]) return; const target = new THREE.Vector3(0, .04, 0); const pos = new THREE.Vector3(...CAMERA_PRESETS[preset]); const dist = pos.length(); pos.normalize().multiplyScalar(state.camera.distance || dist); transition = { started: performance.now(), duration: state.animations ? 460 : 1, fromPos: rendererState.camera.position.clone(), toPos: pos, fromTarget: rendererState.controls.target.clone(), toTarget: target }; state.camera.preset = preset; $$('.view-btn, .camera-preset-grid button').forEach(btn => btn.classList.toggle('active', btn.dataset.camera === preset)); scheduleSave(); pushHistory(); playSound('switch'); }
function updateCamera() { if (!rendererState) return; rendererState.camera.fov = Number(state.camera.fov); rendererState.camera.updateProjectionMatrix(); const currentDirection = rendererState.camera.position.clone().sub(rendererState.controls.target).normalize(); rendererState.camera.position.copy(rendererState.controls.target).add(currentDirection.multiplyScalar(Number(state.camera.distance))); }

function disposeMaterial(material) { if (!material) return; if (material.map) material.map.dispose(); material.dispose(); }
function disposeMesh(mesh) { if (!mesh) return; mesh.geometry.dispose(); const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mats.forEach(disposeMaterial); }
function cropTexture(img, x, y, size, outer) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0,0,64,64); ctx.drawImage(img, x, y, size, size, 0, 0, 64, 64); const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: texture, transparent: outer, alphaTest: outer ? .05 : 0, side: THREE.FrontSide });
}
function makeHeadMaterials(img, outer = false) {
  const scale = img.naturalWidth / 64; const unit = 8 * scale; const ox = outer ? 40 * scale : 8 * scale; const oy = outer ? 8 * scale : 8 * scale;
  const coords = [{ x: ox + 16 * scale, y: oy }, { x: ox - 8 * scale, y: oy }, { x: ox, y: oy - 8 * scale }, { x: ox + 8 * scale, y: oy - 8 * scale }, { x: ox, y: oy }, { x: ox + 8 * scale, y: oy }];
  return coords.map(({x,y}) => cropTexture(img, x, y, unit, outer));
}
function updateSkinMeshes(img) {
  if (!rendererState) return; const { headGroup } = rendererState; if (rendererState.baseMesh) { disposeMesh(rendererState.baseMesh); headGroup.remove(rendererState.baseMesh); } if (rendererState.overlayMesh) { disposeMesh(rendererState.overlayMesh); headGroup.remove(rendererState.overlayMesh); }
  rendererState.baseMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), makeHeadMaterials(img, false)); rendererState.baseMesh.castShadow = true; rendererState.baseMesh.receiveShadow = true; headGroup.add(rendererState.baseMesh);
  if (img.naturalHeight >= img.naturalWidth) { rendererState.overlayMesh = new THREE.Mesh(new THREE.BoxGeometry(1.055, 1.055, 1.055), makeHeadMaterials(img, true)); rendererState.overlayMesh.castShadow = true; headGroup.add(rendererState.overlayMesh); }
  $('#emptyState').classList.add('hidden'); $('#skinMeta').innerHTML = `<span class="meta-icon"><svg><use href="#i-cube"></use></svg></span><span><strong>${escapeHtml(skinInfo.name)}</strong><small>${skinInfo.width}×${skinInfo.height} • ${skinInfo.model}</small></span>`;
  const flash = $('#successFlash'); flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 1800); playSound('success');
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function loadSkinFile(file) {
  if (!file) return; if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) return toast('Please choose a PNG Minecraft skin', 'error');
  const reader = new FileReader(); reader.onload = event => { const img = new Image(); img.onload = () => { const valid = (img.naturalWidth === img.naturalHeight && [64,128].includes(img.naturalWidth)) || (img.naturalWidth === 64 && img.naturalHeight === 32) || (img.naturalWidth === 128 && img.naturalHeight === 64); if (!valid) return toast('Invalid skin. Use a 64×64 or 128×128 PNG.', 'error'); skinData = event.target.result; skinInfo = { name: file.name, width: img.naturalWidth, height: img.naturalHeight, model: 'Minecraft skin' }; updateSkinMeshes(img); if (state.autosave) { try { localStorage.setItem(`${STORAGE_KEY}-skin`, skinData); localStorage.setItem(`${STORAGE_KEY}-skin-info`, JSON.stringify(skinInfo)); } catch { /* storage is optional */ } } }; img.onerror = () => toast('This PNG could not be read as an image', 'error'); img.src = event.target.result; }; reader.onerror = () => toast('Could not read that file', 'error'); reader.readAsDataURL(file); $('#fileInput').value = ''; }
function restoreSkin() { try { const data = localStorage.getItem(`${STORAGE_KEY}-skin`); const info = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-skin-info`) || 'null'); if (!data || !info) return; const img = new Image(); img.onload = () => { skinData = data; skinInfo = info; updateSkinMeshes(img); }; img.src = data; } catch { /* no persisted skin */ } }

function updatePose() {
  if (!rendererState) return; const { headGroup } = rendererState; headGroup.rotation.set(THREE.MathUtils.degToRad(state.pose.x), THREE.MathUtils.degToRad(state.pose.y), THREE.MathUtils.degToRad(state.pose.z)); headGroup.scale.setScalar(state.pose.scale); updateRangeUI(); scheduleSave(); pushHistory();
}
function updateLighting() { if (!rendererState) return; const { ambient, key, rim } = rendererState; ambient.intensity = state.lighting.ambient; key.intensity = state.lighting.main; rim.intensity = state.lighting.rim; const angle = THREE.MathUtils.degToRad(state.lighting.rotation); key.position.set(Math.cos(angle) * 4, 4.5, Math.sin(angle) * 4); rim.position.set(-Math.cos(angle) * 3, 1.8, -Math.sin(angle) * 3); rendererState.shadow.visible = state.lighting.shadow && state.export.shadow; updateRangeUI(); scheduleSave(); pushHistory(); }
function drawBackground() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 768; const ctx = canvas.getContext('2d'); const c1 = state.background.color1; const c2 = state.background.color2; const angle = THREE.MathUtils.degToRad(state.background.angle); const x = Math.cos(angle) * 768, y = Math.sin(angle) * 768; const gradient = ctx.createLinearGradient(384 - x / 2, 384 - y / 2, 384 + x / 2, 384 + y / 2);
  gradient.addColorStop(0, c1); gradient.addColorStop(1, c2); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 768, 768);
  if (state.background.type === 'solid') { ctx.fillStyle = c1; ctx.fillRect(0,0,768,768); }
  if (state.background.type === 'grid') { ctx.globalAlpha = .18; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; for (let n = 0; n <= 768; n += 48) { ctx.beginPath(); ctx.moveTo(n,0); ctx.lineTo(n,768); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0,n); ctx.lineTo(768,n); ctx.stroke(); } ctx.globalAlpha = 1; }
  if (state.background.type === 'glow') { const glow = ctx.createRadialGradient(340,270,15,384,360,470); glow.addColorStop(0, 'rgba(255,255,255,.34)'); glow.addColorStop(.35, 'rgba(255,255,255,.08)'); glow.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = glow; ctx.fillRect(0,0,768,768); }
  return canvas;
}
function updateBackground() { if (!rendererState) return; const material = rendererState.bgPlane.material; if (material.map) material.map.dispose(); if (state.background.type === 'transparent') { material.map = null; material.color.set(0x000000); material.opacity = 0; material.transparent = true; material.needsUpdate = true; } else { const texture = new THREE.CanvasTexture(drawBackground()); texture.colorSpace = THREE.SRGBColorSpace; material.map = texture; material.color.set(0xffffff); material.opacity = 1; material.needsUpdate = true; } updateColorLabels(); scheduleSave(); pushHistory(); }
function updateRangeUI() {
  const map = { rotX: [state.pose.x, v => `${Math.round(v)}°`], rotY: [state.pose.y, v => `${Math.round(v)}°`], rotZ: [state.pose.z, v => `${Math.round(v)}°`], headScale: [state.pose.scale, v => `${Number(v).toFixed(2)}×`], cameraZoom: [state.camera.distance, v => Number(v).toFixed(2)], cameraFov: [state.camera.fov, v => `${Math.round(v)}°`], bgAngle: [state.background.angle, v => `${Math.round(v)}°`], ambientLight: [state.lighting.ambient, v => Number(v).toFixed(2)], mainLight: [state.lighting.main, v => Number(v).toFixed(2)], rimLight: [state.lighting.rim, v => Number(v).toFixed(2)], lightRotation: [state.lighting.rotation, v => `${Math.round(v)}°`] };
  Object.entries(map).forEach(([id, [value, formatter]]) => { const input = $(`#${id}`); const output = $(`#${id}Value`); if (input) { input.value = value; const min = Number(input.min), max = Number(input.max); input.style.setProperty('--range-progress', `${((Number(value) - min) / (max - min)) * 100}%`); } if (output) output.textContent = formatter(value); });
}
function updateColorLabels() { $('#bgColor1').value = state.background.color1; $('#bgColor2').value = state.background.color2; $('#bgColor1Text').textContent = hex(state.background.color1); $('#bgColor2Text').textContent = hex(state.background.color2); }
function renderState() { updatePose(); updateCamera(); updateBackground(); updateLighting(); updateConfigField(); }
function updateConfigField() { $('#configInput').value = JSON.stringify(getConfig(), null, 2); }
function getConfig() { return { version: 2, rotation: { x: state.pose.x, y: state.pose.y, z: state.pose.z }, scale: state.pose.scale, camera: { distance: state.camera.distance, fov: state.camera.fov, preset: state.camera.preset }, background: clone(state.background), lighting: clone(state.lighting), export: clone(state.export) }; }
function applyConfig(raw) { try { const value = raw.trim(); if (!value) throw new Error('empty'); if (!value.startsWith('{')) { const parts = value.split(',').map(Number); if (parts.length !== 4 || parts.some(Number.isNaN)) throw new Error('legacy'); state.pose = { x: parts[0], y: parts[1], z: parts[2], scale: parts[3] }; } else { const parsed = JSON.parse(value); state.pose = { x: Number(parsed.rotation?.x ?? 0), y: Number(parsed.rotation?.y ?? 0), z: Number(parsed.rotation?.z ?? 0), scale: Number(parsed.scale ?? 1.2) }; state.camera = { ...state.camera, ...(parsed.camera || {}) }; state.background = { ...state.background, ...(parsed.background || {}) }; state.lighting = { ...state.lighting, ...(parsed.lighting || {}) }; state.export = { ...state.export, ...(parsed.export || {}) }; } syncUI(); renderState(); scheduleSave(); pushHistory(); toast('Config imported'); playSound('success'); } catch { toast('That configuration is not valid', 'error'); playSound('error'); } }
function syncUI() { document.documentElement.dataset.theme = state.theme; updateRangeUI(); updateColorLabels(); $('#shadowToggle').classList.toggle('on', state.lighting.shadow); $('#shadowToggle').setAttribute('aria-checked', String(state.lighting.shadow)); $('#transparentExport').checked = state.export.transparent; $('#exportShadow').checked = state.export.shadow; $('#highQuality').checked = state.export.highQuality; $('#filename').value = state.export.filename; $('#renderQualityLabel').textContent = state.quality === 'performance' ? 'Performance' : 'High quality'; $$('.theme-switch button').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === state.theme)); $('#soundToggleModal')?.classList.toggle('on', state.sound); $('#motionToggle')?.classList.toggle('on', state.animations); $('#autosaveToggle')?.classList.toggle('on', state.autosave); $('#qualitySelect').value = state.quality; $$('.seg').forEach(b => b.classList.toggle('active', b.dataset.bgType === state.background.type)); $$('.resolution').forEach(b => b.classList.toggle('active', Number(b.dataset.resolution) === Number(state.export.resolution))); $$('.preset[data-pose]').forEach(b => b.classList.toggle('active', b.dataset.pose === 'default')); $$('.preset[data-lighting]').forEach(b => b.classList.toggle('active', b.dataset.lighting === state.lighting.preset)); }
function resetPose() { state.pose = clone(DEFAULTS.pose); $$('.preset[data-pose]').forEach(b => b.classList.toggle('active', b.dataset.pose === 'default')); updatePose(); toast('Pose reset'); }
function resetCamera() { state.camera = clone(DEFAULTS.camera); transitionCamera('front'); updateCamera(); updateRangeUI(); toast('Camera reset'); }
function resetBackground() { state.background = clone(DEFAULTS.background); updateBackground(); updateRangeUI(); renderBackgroundPresetButtons(); toast('Background reset'); }
function resetLighting() { state.lighting = clone(DEFAULTS.lighting); updateLighting(); toast('Lighting reset'); }
function resetAll() { if ($('#settingsModal').open) $('#settingsModal').close(); $('#confirmModal').showModal(); $('#modalBackdrop').hidden = false; }
function confirmReset() { state = mergeState(DEFAULTS, {}); state.theme = state.theme; syncUI(); renderState(); history = [snapshot()]; historyIndex = 0; scheduleSave(); $('#confirmModal').close(); $('#modalBackdrop').hidden = true; toast('Workspace restored'); }
function setTab(tab) { $$('.tab-btn').forEach(btn => { const active = btn.dataset.tab === tab; btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); }); $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tab}`)); playSound('switch'); }
function chooseSkin() { $('#fileInput').click(); }
function showModal(id) { const dialog = $(`#${id}`); if (dialog && !dialog.open) dialog.showModal(); $('#modalBackdrop').hidden = false; }
function closeModal() { $$('dialog[open]').forEach(dialog => dialog.close()); $('#modalBackdrop').hidden = true; }
function fullscreen() { const card = $('#previewCard'); if (!document.fullscreenElement) card.requestFullscreen?.(); else document.exitFullscreen?.(); }
function renderBackgroundPresetButtons() { const wrap = $('#backgroundPresets'); wrap.innerHTML = BG_PRESETS.map(([name, one, two]) => `<button class="bg-preset ${state.background.preset === name ? 'active' : ''}" data-bg-preset="${name}" style="background-image:linear-gradient(135deg,${one},${two})"><span>${name}</span><small>${one.toUpperCase()}</small></button>`).join(''); }
function downloadPNG() {
  if (!rendererState) return toast('3D renderer is not ready', 'error');
  const button = $('.download-btn'); const text = button.querySelector('span'); const old = text.textContent; text.textContent = 'Rendering…'; button.disabled = true;
  const { renderer, camera, container } = rendererState; const size = Number(state.export.resolution); const oldSize = { w: container.clientWidth, h: container.clientHeight, ratio: renderer.getPixelRatio(), clearAlpha: renderer.getClearAlpha() };
  const oldToneMapping = renderer.toneMapping; const oldExposure = renderer.toneMappingExposure; const oldShadowMapEnabled = renderer.shadowMap.enabled;
  state.export.transparent = $('#transparentExport').checked; state.export.shadow = $('#exportShadow').checked; state.export.highQuality = $('#highQuality').checked; rendererState.shadow.visible = state.export.shadow && state.lighting.shadow;
  renderer.toneMapping = state.export.highQuality ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = state.export.highQuality ? 1.05 : 1; renderer.shadowMap.enabled = state.export.highQuality && state.export.shadow;
  const previousBackgroundType = state.background.type;
  if (state.export.transparent) { state.background.type = 'transparent'; updateBackground(); }
  try { renderer.setPixelRatio(1); renderer.setSize(size, size, false); camera.aspect = 1; camera.updateProjectionMatrix(); renderFrame(); const url = renderer.domElement.toDataURL('image/png'); const link = document.createElement('a'); link.href = url; link.download = `${sanitizeFilename(state.export.filename)}.png`; link.click(); toast('Image downloaded'); playSound('success'); } catch { toast('Export failed. Try a smaller resolution.', 'error'); playSound('error'); }
  state.background.type = previousBackgroundType; renderer.toneMapping = oldToneMapping; renderer.toneMappingExposure = oldExposure; renderer.shadowMap.enabled = oldShadowMapEnabled; rendererState.shadow.visible = state.lighting.shadow && state.export.shadow; renderer.setPixelRatio(oldSize.ratio); renderer.setSize(oldSize.w, oldSize.h, false); camera.aspect = oldSize.w / Math.max(1, oldSize.h); camera.updateProjectionMatrix(); updateBackground(); button.disabled = false; text.textContent = old; scheduleSave();
}

function bindEvents() {
  $('#fileInput').addEventListener('change', e => loadSkinFile(e.target.files?.[0])); $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  $$('[data-action="choose-skin"]').forEach(el => el.addEventListener('click', chooseSkin));
  $$('.range').forEach(input => input.addEventListener('input', () => { const v = Number(input.value); if (input.id === 'rotX') state.pose.x = v; if (input.id === 'rotY') state.pose.y = v; if (input.id === 'rotZ') state.pose.z = v; if (input.id === 'headScale') state.pose.scale = v; if (input.id === 'cameraZoom') { state.camera.distance = v; updateCamera(); } if (input.id === 'cameraFov') state.camera.fov = v; if (input.id === 'bgAngle') state.background.angle = v; if (input.id === 'ambientLight') state.lighting.ambient = v; if (input.id === 'mainLight') state.lighting.main = v; if (input.id === 'rimLight') state.lighting.rim = v; if (input.id === 'lightRotation') state.lighting.rotation = v; if (['rotX','rotY','rotZ','headScale'].includes(input.id)) updatePose(); else if (['cameraZoom','cameraFov'].includes(input.id)) { updateCamera(); updateRangeUI(); scheduleSave(); pushHistory(); } else if (input.id === 'bgAngle') updateBackground(); else if (['ambientLight','mainLight','rimLight','lightRotation'].includes(input.id)) updateLighting(); }));
  $('#bgColor1').addEventListener('input', e => { state.background.color1 = e.target.value; state.background.preset = ''; updateBackground(); }); $('#bgColor2').addEventListener('input', e => { state.background.color2 = e.target.value; state.background.preset = ''; updateBackground(); });
  $$('.seg').forEach(btn => btn.addEventListener('click', () => { state.background.type = btn.dataset.bgType; updateBackground(); syncUI(); }));
  $('#backgroundPresets').addEventListener('click', e => { const btn = e.target.closest('[data-bg-preset]'); if (!btn) return; const p = BG_PRESETS.find(item => item[0] === btn.dataset.bgPreset); if (!p) return; state.background = { ...state.background, type: 'gradient', preset: p[0], color1: p[1], color2: p[2], angle: p[3] }; updateBackground(); renderBackgroundPresetButtons(); syncUI(); toast(`${p[0]} background applied`); });
  $('#posePresets').addEventListener('click', e => { const btn = e.target.closest('[data-pose]'); if (!btn) return; const [x,y,z,scale] = POSE_PRESETS[btn.dataset.pose]; state.pose = { x, y, z, scale }; $$('.preset[data-pose]').forEach(b => b.classList.toggle('active', b === btn)); updatePose(); toast(`${btn.textContent} pose applied`); });
  $$('.lighting-presets').forEach(wrap => wrap.addEventListener('click', e => { const btn = e.target.closest('[data-lighting]'); if (!btn) return; const [ambient, main, rim, rotation] = LIGHT_PRESETS[btn.dataset.lighting]; state.lighting = { ...state.lighting, ambient, main, rim, rotation, preset: btn.dataset.lighting }; updateLighting(); syncUI(); toast(`${btn.textContent} lighting applied`); }));
  $$('.view-btn, .camera-preset-grid button, .quick-card[data-camera]').forEach(btn => btn.addEventListener('click', () => transitionCamera(btn.dataset.camera)));
  $('#transparentExport').addEventListener('change', e => { state.export.transparent = e.target.checked; if (e.target.checked) state.background.type = 'transparent'; else if (state.background.type === 'transparent') state.background.type = 'gradient'; updateBackground(); syncUI(); }); $('#exportShadow').addEventListener('change', e => { state.export.shadow = e.target.checked; updateLighting(); }); $('#highQuality').addEventListener('change', e => { state.export.highQuality = e.target.checked; });
  $$('.resolution').forEach(btn => btn.addEventListener('click', () => { state.export.resolution = Number(btn.dataset.resolution); syncUI(); scheduleSave(); })); $('#filename').addEventListener('input', e => { state.export.filename = e.target.value; scheduleSave(); });
  $('#configInput').addEventListener('change', e => applyConfig(e.target.value));
  $$('[data-action]').forEach(btn => btn.addEventListener('click', () => { const action = btn.dataset.action; if (action === 'toggle-theme') { state.theme = state.theme === 'dark' ? 'light' : 'dark'; syncUI(); scheduleSave(); playSound('switch'); } if (action === 'toggle-sound') { state.sound = !state.sound; syncUI(); playSound('click'); } if (action === 'open-help') showModal('helpModal'); if (action === 'open-settings') showModal('settingsModal'); if (action === 'close-modal') closeModal(); if (action === 'fullscreen') fullscreen(); if (action === 'undo') undo(); if (action === 'redo') redo(); if (action === 'reset-camera') resetCamera(); if (action === 'reset-pose') resetPose(); if (action === 'reset-background') resetBackground(); if (action === 'reset-lighting') resetLighting(); if (action === 'download') downloadPNG(); if (action === 'copy-config') copyConfig(); if (action === 'import-config') applyConfig($('#configInput').value); if (action === 'export-config') exportConfig(); if (action === 'reset-all') resetAll(); if (action === 'confirm-reset') confirmReset(); if (action === 'toggle-shadow') { state.lighting.shadow = !state.lighting.shadow; updateLighting(); syncUI(); } if (action === 'toggle-motion') { state.animations = !state.animations; syncUI(); scheduleSave(); } if (action === 'toggle-autosave') { state.autosave = !state.autosave; syncUI(); if (state.autosave) persist(); } }));
  $('#qualitySelect').addEventListener('change', e => { state.quality = e.target.value; syncUI(); resizeRenderer(); scheduleSave(); }); $$('.theme-switch button').forEach(btn => btn.addEventListener('click', () => { state.theme = btn.dataset.themeChoice; syncUI(); scheduleSave(); }));
  const dropTarget = $('#rendererContainer'); ['dragenter','dragover'].forEach(type => dropTarget.addEventListener(type, e => { e.preventDefault(); $('#dropOverlay').classList.add('visible'); dropTarget.classList.add('dragging'); })); ['dragleave','drop'].forEach(type => dropTarget.addEventListener(type, e => { e.preventDefault(); if (type === 'drop') loadSkinFile(e.dataTransfer.files?.[0]); $('#dropOverlay').classList.remove('visible'); dropTarget.classList.remove('dragging'); }));
  $('#modalBackdrop').addEventListener('click', closeModal); $$('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (!$$('dialog[open]').length) $('#modalBackdrop').hidden = true; })); window.addEventListener('keydown', handleShortcuts); window.addEventListener('pointerdown', () => { if (audioContext?.state === 'suspended') audioContext.resume(); }, { once: true });
}
async function copyConfig() { const text = JSON.stringify(getConfig(), null, 2); $('#configInput').value = text; try { await navigator.clipboard.writeText(text); toast('Config copied'); } catch { $('#configInput').select(); document.execCommand('copy'); toast('Config copied'); } playSound('success'); }
function exportConfig() { const blob = new Blob([JSON.stringify(getConfig(), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'skvizhead-config.json'; link.click(); URL.revokeObjectURL(link.href); toast('Config exported'); }
function handleShortcuts(e) { const target = e.target; const typing = ['INPUT','TEXTAREA','SELECT'].includes(target.tagName); if (e.key === '?' && !typing) { showModal('helpModal'); return; } if (typing) return; if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); } else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); downloadPNG(); } else if (e.key.toLowerCase() === 'r') resetPose(); else if (e.key === '1') transitionCamera('front'); else if (e.key === '2') transitionCamera('threequarter'); else if (e.key === '3') transitionCamera('side'); else if (e.code === 'Space') { e.preventDefault(); resetCamera(); } else if (e.key.toLowerCase() === 'b') transitionCamera('back'); }

function bootstrap() { renderBackgroundPresetButtons(); bindEvents(); syncUI(); history = [snapshot()]; historyIndex = 0; initRenderer(); restoreSkin(); updateConfigField(); }
bootstrap();
