//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

interface LinkedSession {
    texture: Texture;
    originalCanvas: HTMLCanvasElement;
    originalUVs: Map<string, number[]>;
    faceLayerMap: Map<string, TextureLayer>;
    baseLayer: TextureLayer;
}

let activeSession: LinkedSession | null = null;
let insideUndoRedo = false;

interface LayerSnapshot {
    canvas: HTMLCanvasElement;
}

let layerRotationState: {
    snapshots: Map<string, LayerSnapshot>;
    originalRotations: Map<string, number>;
} | null = null;

function shouldUseLinkedMode(): boolean {
    return !!(
        FORMAT_IDS.includes(Format.id) &&
        (BarItems as any).move_texture_with_uv?.value &&
        (UVEditor as any).vue?.texture
    );
}

function getPixelFactors(texture: Texture): [number, number] {
    return [
        texture.width / UVEditor.getUVWidth(),
        texture.height / UVEditor.getUVHeight()
    ];
}

function faceKey(cubeUuid: string, fkey: string): string {
    return `${cubeUuid}:${fkey}`;
}

function getFacePixelRect(face: CubeFace, factorX: number, factorY: number) {
    let rect = face.getBoundingRect();
    let x = Math.floor(rect.ax * factorX);
    let y = Math.floor(rect.ay * factorY);
    let w = Math.ceil(rect.bx * factorX) - x;
    let h = Math.ceil(rect.by * factorY) - y;
    return { x, y, w, h };
}

function getBoxUVPixelRect(cube: Cube, factorX: number, factorY: number) {
    let size = cube.size(undefined, (Format as any).box_uv_float_size != true);
    let uvW = size[2] + size[0] + (size[1] ? size[2] : 0) + size[0];
    let uvH = size[2] + size[1];
    let x = Math.floor(cube.uv_offset[0] * factorX);
    let y = Math.floor(cube.uv_offset[1] * factorY);
    let w = Math.ceil((cube.uv_offset[0] + uvW) * factorX) - x;
    let h = Math.ceil((cube.uv_offset[1] + uvH) * factorY) - y;
    return { x, y, w, h };
}

function captureUVs(texture: Texture): Map<string, number[]> {
    let originalUVs = new Map<string, number[]>();
    for (let cube of Cube.all) {
        if ((cube as any).box_uv) {
            originalUVs.set(faceKey(cube.uuid, '__box__'), [...cube.uv_offset]);
        } else {
            for (let fkey in cube.faces) {
                let face = cube.faces[fkey as CubeFaceDirection];
                if (face.texture === null) continue;
                if ((face as any).getTexture() !== texture) continue;
                originalUVs.set(faceKey(cube.uuid, fkey), [...face.uv]);
            }
        }
    }
    return originalUVs;
}

function snapshotCanvas(texture: Texture): HTMLCanvasElement {
    let canvas = document.createElement('canvas');
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.getContext('2d')!.drawImage((texture as any).canvas, 0, 0);
    return canvas;
}

function rebuildSessionFromLayers(texture: Texture): LinkedSession {
    let layers = (texture as any).layers as TextureLayer[];
    let baseLayer = layers[0];

    // Snapshot the composited canvas as the "original" for this rebuilt session
    (texture as any).updateLayerChanges(false);
    let originalCanvas = snapshotCanvas(texture);

    // Rebuild faceLayerMap from layer names (set during ensureFaceLayer)
    let faceLayerMap = new Map<string, TextureLayer>();
    for (let i = 1; i < layers.length; i++) {
        let layer = layers[i];
        if (layer.name && layer.name.includes(':')) {
            faceLayerMap.set(layer.name, layer);
        }
    }

    activeSession = {
        texture,
        originalCanvas,
        originalUVs: captureUVs(texture),
        faceLayerMap,
        baseLayer,
    };
    return activeSession;
}

function ensureSession(texture: Texture, elements: OutlinerElement[]): LinkedSession {
    if (activeSession && activeSession.texture === texture) return activeSession;
    if (activeSession && activeSession.texture !== texture) {
        bakeSession();
    }

    // Layers already active (e.g. after redo) — rebuild session from existing layers
    if ((texture as any).layers_enabled) {
        return rebuildSessionFromLayers(texture);
    }

    let originalCanvas = snapshotCanvas(texture);

    (texture as any).activateLayers(false);
    let baseLayer = (texture as any).layers[0] as TextureLayer;

    activeSession = {
        texture,
        originalCanvas,
        originalUVs: captureUVs(texture),
        faceLayerMap: new Map(),
        baseLayer,
    };
    return activeSession;
}

function rectsOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

type PixelRect = { x: number; y: number; w: number; h: number };

function getOverlappingNonDraggedRects(
    pixelRect: PixelRect,
    draggedKeys: Set<string>,
    texture: Texture,
    factorX: number,
    factorY: number
): PixelRect[] {
    let rects: PixelRect[] = [];
    for (let cube of Cube.all) {
        if (!cube.visibility) continue;
        if ((cube as any).box_uv) {
            let key = faceKey(cube.uuid, '__box__');
            if (draggedKeys.has(key)) continue;
            let otherRect = getBoxUVPixelRect(cube, factorX, factorY);
            if (rectsOverlap(pixelRect, otherRect)) rects.push(otherRect);
        } else {
            for (let fkey in cube.faces) {
                let face = cube.faces[fkey as CubeFaceDirection];
                if (face.texture === null) continue;
                if ((face as any).getTexture() !== texture) continue;
                let key = faceKey(cube.uuid, fkey);
                if (draggedKeys.has(key)) continue;
                let otherRect = getFacePixelRect(face, factorX, factorY);
                if (rectsOverlap(pixelRect, otherRect)) rects.push(otherRect);
            }
        }
    }
    return rects;
}

function ensureFaceLayer(
    session: LinkedSession,
    cube: Cube,
    layerKey: string,
    pixelRect: PixelRect,
    overlappingRects: PixelRect[] = []
) {
    if (session.faceLayerMap.has(layerKey)) return;
    if (pixelRect.w <= 0 || pixelRect.h <= 0) return;

    let layer = new TextureLayer(
        { offset: [pixelRect.x, pixelRect.y] } as any,
        session.texture
    );
    layer.setSize(pixelRect.w, pixelRect.h);

    // Read from original snapshot — base layer may already have holes from earlier extractions
    layer.ctx.drawImage(
        session.originalCanvas,
        pixelRect.x, pixelRect.y,
        pixelRect.w, pixelRect.h,
        0, 0,
        pixelRect.w, pixelRect.h
    );

    let baseOffX = session.baseLayer.offset[0];
    let baseOffY = session.baseLayer.offset[1];

    // Clear dragged area from base layer
    session.baseLayer.ctx.clearRect(
        pixelRect.x - baseOffX, pixelRect.y - baseOffY,
        pixelRect.w, pixelRect.h
    );

    // Restore only the intersection areas where non-dragged faces sit
    for (let other of overlappingRects) {
        let ix = Math.max(pixelRect.x, other.x);
        let iy = Math.max(pixelRect.y, other.y);
        let iw = Math.min(pixelRect.x + pixelRect.w, other.x + other.w) - ix;
        let ih = Math.min(pixelRect.y + pixelRect.h, other.y + other.h) - iy;
        if (iw <= 0 || ih <= 0) continue;
        session.baseLayer.ctx.drawImage(
            session.originalCanvas,
            ix, iy, iw, ih,
            ix - baseOffX, iy - baseOffY, iw, ih
        );
    }

    layer.name = layerKey;
    layer.addForEditing();
    session.faceLayerMap.set(layerKey, layer);
}

function createLayersForDraggedFaces(
    session: LinkedSession,
    elements: OutlinerElement[],
    texture: Texture
) {
    let [factorX, factorY] = getPixelFactors(texture);

    // Collect all dragged face keys first for overlap detection
    let draggedKeys = new Set<string>();
    for (let el of elements) {
        if (!(el instanceof Cube)) continue;
        if ((el as any).box_uv) {
            draggedKeys.add(faceKey(el.uuid, '__box__'));
        } else {
            let selectedFaces = UVEditor.getSelectedFaces(el);
            for (let fkey of selectedFaces) {
                let face = el.faces[fkey as CubeFaceDirection];
                if (!face || face.texture === null) continue;
                if ((face as any).getTexture() !== texture) continue;
                draggedKeys.add(faceKey(el.uuid, fkey));
            }
        }
    }

    for (let el of elements) {
        if (!(el instanceof Cube)) continue;

        if ((el as any).box_uv) {
            let key = faceKey(el.uuid, '__box__');
            let pixelRect = getBoxUVPixelRect(el, factorX, factorY);
            let overlaps = getOverlappingNonDraggedRects(pixelRect, draggedKeys, texture, factorX, factorY);
            ensureFaceLayer(session, el, key, pixelRect, overlaps);
        } else {
            let selectedFaces = UVEditor.getSelectedFaces(el);
            for (let fkey of selectedFaces) {
                let face = el.faces[fkey as CubeFaceDirection];
                if (!face || face.texture === null) continue;
                if ((face as any).getTexture() !== texture) continue;

                let key = faceKey(el.uuid, fkey);
                let pixelRect = getFacePixelRect(face, factorX, factorY);
                let overlaps = getOverlappingNonDraggedRects(pixelRect, draggedKeys, texture, factorX, factorY);
                ensureFaceLayer(session, el, key, pixelRect, overlaps);
            }
        }
    }

}

function bringDraggedLayersToTop(
    session: LinkedSession,
    elements: OutlinerElement[],
    texture: Texture
) {
    let draggedLayers: TextureLayer[] = [];
    for (let el of elements) {
        if (!(el instanceof Cube)) continue;
        if ((el as any).box_uv) {
            let layer = session.faceLayerMap.get(faceKey(el.uuid, '__box__'));
            if (layer) draggedLayers.push(layer);
        } else {
            let selectedFaces = UVEditor.getSelectedFaces(el);
            for (let fkey of selectedFaces) {
                let layer = session.faceLayerMap.get(faceKey(el.uuid, fkey));
                if (layer) draggedLayers.push(layer);
            }
        }
    }
    let layers = (texture as any).layers as TextureLayer[];
    for (let layer of draggedLayers) {
        let idx = layers.indexOf(layer);
        if (idx > -1) layers.splice(idx, 1);
    }
    layers.push(...draggedLayers);
}

function syncLayerOffsets(
    session: LinkedSession,
    elements: OutlinerElement[],
    texture: Texture
) {
    let [factorX, factorY] = getPixelFactors(texture);

    for (let el of elements) {
        if (!(el instanceof Cube)) continue;

        if ((el as any).box_uv) {
            let key = faceKey(el.uuid, '__box__');
            let layer = session.faceLayerMap.get(key);
            if (layer) {
                layer.offset[0] = Math.round(el.uv_offset[0] * factorX);
                layer.offset[1] = Math.round(el.uv_offset[1] * factorY);
            }
        } else {
            let selectedFaces = UVEditor.getSelectedFaces(el);
            for (let fkey of selectedFaces) {
                let key = faceKey(el.uuid, fkey);
                let layer = session.faceLayerMap.get(key);
                if (!layer) continue;

                let face = el.faces[fkey as CubeFaceDirection];
                let rect = face.getBoundingRect();
                layer.offset[0] = Math.round(rect.ax * factorX);
                layer.offset[1] = Math.round(rect.ay * factorY);
            }
        }
    }
}

function flattenTexture(texture: Texture) {
    if (!(texture as any).layers_enabled) return;

    (texture as any).updateLayerChanges(true);

    let composited = document.createElement('canvas');
    composited.width = texture.width;
    composited.height = texture.height;
    composited.getContext('2d')!.drawImage((texture as any).canvas, 0, 0);

    while ((texture as any).layers.length) {
        (texture as any).layers[0].remove(false);
    }
    (texture as any).layers_enabled = false;
    (texture as any).selected_layer = null;

    let ctx = (texture as any).ctx as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, texture.width, texture.height);
    ctx.drawImage(composited, 0, 0);
    (texture as any).updateChangesAfterEdit();
}

function bakeSession() {
    if (!activeSession) return;
    let { texture } = activeSession;

    Undo.initEdit({ textures: [texture], bitmap: true });
    flattenTexture(texture);
    Undo.finishEdit('Bake linked UV layout');
    activeSession = null;
}

function teardownSession() {
    if (!activeSession) return;
    let { texture } = activeSession;
    activeSession = null;
    flattenTexture(texture);
}

function rotateCanvasByDegrees(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
    let norm = ((degrees % 360) + 360) % 360;
    let sw = source.width, sh = source.height;
    let result = document.createElement('canvas');
    if (norm === 90 || norm === 270) {
        result.width = sh;
        result.height = sw;
    } else {
        result.width = sw;
        result.height = sh;
    }
    if (norm === 0) {
        result.getContext('2d')!.drawImage(source, 0, 0);
        return result;
    }
    let ctx = result.getContext('2d')!;
    ctx.translate(result.width / 2, result.height / 2);
    ctx.rotate(-norm * Math.PI / 180);
    ctx.drawImage(source, -sw / 2, -sh / 2);
    return result;
}

function captureLayerSnapshotsForRotation(session: LinkedSession): Map<string, LayerSnapshot> {
    let snapshots = new Map<string, LayerSnapshot>();
    for (let el of UVEditor.getMappableElements()) {
        if (!(el instanceof Cube)) continue;
        for (let fkey of UVEditor.getSelectedFaces(el)) {
            let key = faceKey(el.uuid, fkey);
            let layer = session.faceLayerMap.get(key);
            if (!layer) continue;
            let canvas = document.createElement('canvas');
            canvas.width = layer.canvas.width;
            canvas.height = layer.canvas.height;
            canvas.getContext('2d')!.drawImage(layer.canvas, 0, 0);
            snapshots.set(key, { canvas });
        }
    }
    return snapshots;
}

function captureCurrentRotations(): Map<string, number> {
    let rotations = new Map<string, number>();
    for (let el of UVEditor.getMappableElements()) {
        if (!(el instanceof Cube)) continue;
        for (let fkey of UVEditor.getSelectedFaces(el)) {
            let face = el.faces[fkey as CubeFaceDirection];
            rotations.set(faceKey(el.uuid, fkey), face.rotation || 0);
        }
    }
    return rotations;
}

function applyLayerRotations(
    session: LinkedSession,
    snapshots: Map<string, LayerSnapshot>,
    getDegrees: (key: string) => number
) {
    for (let [key, snapshot] of snapshots) {
        let layer = session.faceLayerMap.get(key);
        if (!layer) continue;
        let degrees = getDegrees(key);
        let rotated = rotateCanvasByDegrees(snapshot.canvas, degrees);
        layer.setSize(rotated.width, rotated.height);
        layer.ctx.drawImage(rotated, 0, 0);
    }
    syncLayerOffsets(session, UVEditor.getMappableElements(), session.texture);
}

function linkedRotateFace(this: any, event: MouseEvent | TouchEvent) {
    let me = event as MouseEvent;
    if (me.which === 2 || me.which === 3) return;
    event.stopPropagation();
    (window as any).convertTouchEvent(event);

    let elements = UVEditor.getMappableElements();
    let texture = this.texture as Texture;
    if (!texture) return;

    Undo.initEdit({
        elements,
        uv_only: true,
        bitmap: true,
        textures: [texture]
    } as any);

    let session = ensureSession(texture, elements);
    createLayersForDraggedFaces(session, elements, texture);

    let faceCenter = [0, 0];
    let points = 0;
    for (let el of elements) {
        if (!(el instanceof Cube)) continue;
        for (let fkey of UVEditor.getSelectedFaces(el)) {
            let face = el.faces[fkey as CubeFaceDirection];
            if (face instanceof CubeFace) {
                faceCenter[0] += face.uv[0] + face.uv[2];
                faceCenter[1] += face.uv[1] + face.uv[3];
                points += 2;
            }
        }
    }
    if (points === 0) return;
    faceCenter[0] /= points;
    faceCenter[1] /= points;

    let snapshots = captureLayerSnapshotsForRotation(session);

    let frameOffset = ($ as any)(this.$refs.frame).offset();
    let pixelSize = UVEditor.getUVPixelSize();
    let centerOnScreen = [
        faceCenter[0] * pixelSize + frameOffset.left,
        faceCenter[1] * pixelSize + frameOffset.top,
    ];

    let lastAngle: number | undefined;
    let originalAngle: number | undefined;
    let cumulativeRotation = 0;
    let scope = this;
    let dragging = false;

    let drag = (e1: Event) => {
        (window as any).convertTouchEvent(e1);
        let me1 = e1 as MouseEvent;
        let angle = Math.atan2(
            me1.clientY - centerOnScreen[1],
            me1.clientX - centerOnScreen[0],
        );
        angle = Math.round(Math.radToDeg(angle) / 90) * 90;
        if (originalAngle === undefined) originalAngle = angle;
        angle -= originalAngle;
        if (lastAngle === undefined) lastAngle = angle;
        if (Math.abs(angle - lastAngle) > 300) lastAngle = angle;

        if (angle !== lastAngle) {
            scope.helper_lines.x = scope.helper_lines.y = -1;
            let rotationStep = 90 * Math.sign(lastAngle - angle);
            cumulativeRotation = (cumulativeRotation + rotationStep + 360) % 360;

            for (let el of elements) {
                if (!(el instanceof Cube)) continue;
                if (!(el as any).getTypeBehavior?.('cube_faces')) continue;
                for (let fkey of UVEditor.getSelectedFaces(el)) {
                    let face = el.faces[fkey as CubeFaceDirection];
                    if (!face) continue;
                    face.rotation = ((face.rotation || 0) + rotationStep + 360) % 360;
                }
                (el as any).preview_controller.updateUV(el);
            }

            UVEditor.turnMapping();
            applyLayerRotations(session, snapshots, () => cumulativeRotation);
            (texture as any).updateLayerChanges(false);

            lastAngle = angle;
            UVEditor.loadData();
            (UVEditor as any).vue.$forceUpdate();
            Canvas.updateView({ elements, element_aspects: { uv: true } });
            scope.dragging_uv = true;
            dragging = true;
        }
    };

    let stop = () => {
        (window as any).removeEventListeners(document, 'mousemove touchmove', drag);
        (window as any).removeEventListeners(document, 'mouseup touchend', stop);
        scope.helper_lines.x = scope.helper_lines.y = -1;
        if (dragging) {
            (texture as any).updateLayerChanges(true);
            UVEditor.disableAutoUV();
            Undo.finishEdit('Rotate UV');
            setTimeout(() => scope.dragging_uv = false, 10);
        } else {
            Undo.cancelEdit();
        }
    };

    (window as any).addEventListeners(document, 'mousemove touchmove', drag);
    (window as any).addEventListeners(document, 'mouseup touchend', stop);
}

function linkedDragFace(this: any, element: any, face_key: string | null, event: MouseEvent | TouchEvent) {
    if ((event as MouseEvent).which == 2 || (event as MouseEvent).which == 3) return;

    let me = event as any;
    let addToSelection = me.shiftKey || me.ctrlOrCmd || (Pressing as any).overrides?.shift || (Pressing as any).overrides?.ctrl;

    // Only clear other elements' selections when clicking an unselected face
    if (element && face_key && !addToSelection) {
        let currentFaces = UVEditor.getSelectedFaces(element);
        if (!currentFaces.includes(face_key)) {
            for (let el of UVEditor.getMappableElements()) {
                if (el === element) continue;
                let faces = UVEditor.getSelectedFaces(el, true);
                if (faces?.length) (faces as any).empty?.() || faces.splice(0);
            }
        }
    }

    if (element && face_key) this.selectFace(element, face_key, event, true);
    let elements: OutlinerElement[] = UVEditor.getMappableElements();
    let texture = this.texture as Texture;
    if (!texture) return;

    Undo.initEdit({ elements, uv_only: true });

    let started = false;
    let session: LinkedSession;

    this.drag({
        event,
        snap: UVEditor.isBoxUV() ? 1 : undefined,
        onDrag: (diff_x: number, diff_y: number) => {
            if (!started) {
                started = true;

                // Capture state BEFORE activating layers so undo fully reverts
                Undo.initEdit({
                    elements,
                    uv_only: true,
                    bitmap: true,
                    textures: [texture]
                });

                session = ensureSession(texture, elements);
                createLayersForDraggedFaces(session, elements, texture);
                bringDraggedLayersToTop(session, elements, texture);
            }

            // Clamping (cube-only, no mesh support needed)
            elements.forEach((el: any) => {
                if (el.box_uv) {
                    let size = el.size(undefined, (Format as any).box_uv_float_size != true);
                    let uv_size = [
                        size[2] + size[0] + (size[1] ? size[2] : 0) + size[0],
                        size[2] + size[1],
                    ];
                    if (UVEditor.isUVClamped()) {
                        diff_x = Math.clamp(diff_x, -el.uv_offset[0] - (size[1] ? 0 : size[2]), UVEditor.getUVWidth() - el.uv_offset[0] - uv_size[0]);
                        diff_y = Math.clamp(diff_y, -el.uv_offset[1] - (size[0] ? 0 : size[2]), UVEditor.getUVHeight() - el.uv_offset[1] - uv_size[1]);
                    }
                } else {
                    if (UVEditor.isUVClamped()) {
                        UVEditor.getSelectedFaces(el).forEach((key: string) => {
                            let face = el.faces[key];
                            if (face && el.getTypeBehavior?.('cube_faces') && face.texture !== null) {
                                diff_x = Math.clamp(diff_x, -face.uv[0], UVEditor.getUVWidth() - face.uv[0]);
                                diff_y = Math.clamp(diff_y, -face.uv[1], UVEditor.getUVHeight() - face.uv[1]);
                                diff_x = Math.clamp(diff_x, -face.uv[2], UVEditor.getUVWidth() - face.uv[2]);
                                diff_y = Math.clamp(diff_y, -face.uv[3], UVEditor.getUVHeight() - face.uv[3]);
                            }
                        });
                    }
                }
            });

            // Apply UV changes
            elements.forEach((el: any) => {
                if (el.box_uv) {
                    el.uv_offset[0] = Math.floor(el.uv_offset[0] + diff_x);
                    el.uv_offset[1] = Math.floor(el.uv_offset[1] + diff_y);
                } else {
                    UVEditor.getSelectedFaces(el).forEach((key: string) => {
                        let face = el.faces[key];
                        if (face instanceof CubeFace && face.texture !== null) {
                            face.uv[0] += diff_x;
                            face.uv[1] += diff_y;
                            face.uv[2] += diff_x;
                            face.uv[3] += diff_y;
                        }
                    });
                }
            });

            // Sync layer positions to new UV coords
            if (session) {
                syncLayerOffsets(session, elements, texture);
                (texture as any).updateLayerChanges(false);
            }

            return [diff_x, diff_y];
        },
        onEnd: () => {
            UVEditor.disableAutoUV();
            if (session) {
                (texture as any).updateLayerChanges(true);
            }
            Canvas.updateView({ elements, element_aspects: { uv: true } });
            Undo.finishEdit('Move UV');
        },
        onAbort: () => {}
    });
}

function getSelectedFaceKey(): string | null {
    if (!activeSession) return null;
    let elements = UVEditor.getMappableElements();
    for (let el of elements) {
        if (!(el instanceof Cube)) continue;
        let selected = UVEditor.getSelectedFaces(el);
        if (selected.length) {
            if ((el as any).box_uv) {
                return faceKey(el.uuid, '__box__');
            }
            return faceKey(el.uuid, selected[0]);
        }
    }
    return null;
}

function moveFaceLayer(direction: 1 | -1) {
    if (!activeSession) return;
    let key = getSelectedFaceKey();
    if (!key) return;
    let layer = activeSession.faceLayerMap.get(key);
    if (!layer) return;

    let layers = (activeSession.texture as any).layers as TextureLayer[];
    let idx = layers.indexOf(layer);
    let targetIdx = idx + direction;
    // Don't swap with the base layer (index 0)
    if (targetIdx < 1 || targetIdx >= layers.length) return;

    Undo.initEdit({ textures: [activeSession.texture], bitmap: true });
    [layers[idx], layers[targetIdx]] = [layers[targetIdx], layers[idx]];
    (activeSession.texture as any).updateLayerChanges(true);
    Undo.finishEdit('Reorder UV face layer');
}

export function setupNondestructiveUVMove() {
    // Override UVEditor.vue.dragFace to intercept linked UV mode
    let vue = (UVEditor as any).vue;
    let originalDragFace = vue.dragFace;

    vue.dragFace = function (element: any, face_key: string | null, event: MouseEvent | TouchEvent) {
        if (shouldUseLinkedMode()) {
            return linkedDragFace.call(this, element, face_key, event);
        }
        return originalDragFace.call(this, element, face_key, event);
    };
    track({
        delete() {
            vue.dragFace = originalDragFace;
        }
    });

    // Intercept rotateFace (corner drag) to rotate layers instead of corrupting texture.ctx
    let originalRotateFace = vue.rotateFace;
    vue.rotateFace = function (event: MouseEvent | TouchEvent) {
        if (shouldUseLinkedMode()) {
            return linkedRotateFace.call(this, event);
        }
        return originalRotateFace.call(this, event);
    };
    track({
        delete() {
            vue.rotateFace = originalRotateFace;
        }
    });

    // Intercept rotation slider to rotate layers instead of corrupting texture.ctx
    let rotationSlider = BarItems.uv_rotation as any;
    let originalRotate = UVEditor.rotate.bind(UVEditor);
    if (rotationSlider) {
        let originalOnBefore = rotationSlider.onBefore;
        let originalOnAfter = rotationSlider.onAfter;

        rotationSlider.onBefore = function (...args: any[]) {
            if (shouldUseLinkedMode()) {
                let texture = (UVEditor as any).vue?.texture as Texture;
                if (!texture) return originalOnBefore?.apply(this, args);

                originalOnBefore?.apply(this, args);

                let elements = UVEditor.getMappableElements();
                let session = ensureSession(texture, elements);
                createLayersForDraggedFaces(session, elements, texture);

                layerRotationState = {
                    snapshots: captureLayerSnapshotsForRotation(session),
                    originalRotations: captureCurrentRotations(),
                };
                (UVEditor as any)._originalPixels = null;
                return;
            }
            return originalOnBefore?.apply(this, args);
        };

        rotationSlider.onAfter = function (...args: any[]) {
            if (layerRotationState && activeSession) {
                (activeSession.texture as any).updateLayerChanges(true);
                layerRotationState = null;
            }
            return originalOnAfter?.apply(this, args);
        };

        track({
            delete() {
                rotationSlider.onBefore = originalOnBefore;
                rotationSlider.onAfter = originalOnAfter;
            }
        });
    }

    (UVEditor as any).rotate = function (...args: any[]) {
        originalRotate(...args);
        if (layerRotationState && activeSession) {
            let value = parseInt(rotationSlider?.get() || '0');
            applyLayerRotations(activeSession, layerRotationState.snapshots, key => {
                let origRot = layerRotationState!.originalRotations.get(key) || 0;
                return (value - origRot + 360) % 360;
            });
            (activeSession.texture as any).updateLayerChanges(false);
        }
    };
    track({
        delete() {
            (UVEditor as any).rotate = originalRotate;
        }
    });

    // Bake action — placed in UV editor toolbar
    let bakeAction = new Action('hytale_bake_uv_texture', {
        name: 'Bake UV Layout',
        icon: 'layers_clear',
        category: 'uv',
        condition: { formats: FORMAT_IDS, modes: ['edit'] },
        click: () => bakeSession()
    });
    track(bakeAction);
    (Toolbars as any).uv_editor?.add(bakeAction, 2);

    // Depth ordering actions
    let moveUpAction = new Action('hytale_uv_face_up', {
        name: 'Move UV Face Up',
        icon: 'arrow_upward',
        category: 'uv',
        condition: { formats: FORMAT_IDS, modes: ['edit'] },
        click: () => moveFaceLayer(1)
    });
    track(moveUpAction);
    (Toolbars as any).uv_editor?.add(moveUpAction, 3);

    let moveDownAction = new Action('hytale_uv_face_down', {
        name: 'Move UV Face Down',
        icon: 'arrow_downward',
        category: 'uv',
        condition: { formats: FORMAT_IDS, modes: ['edit'] },
        click: () => moveFaceLayer(-1)
    });
    track(moveDownAction);
    (Toolbars as any).uv_editor?.add(moveDownAction, 4);

    // On undo/redo, just discard session state
    function onUndoRedo() {
        insideUndoRedo = true;
        activeSession = null;
        insideUndoRedo = false;
    }
    let undoListener = Blockbench.on('undo' as any, onUndoRedo);
    track(undoListener);

    let redoListener = Blockbench.on('redo' as any, onUndoRedo);
    track(redoListener);

    function bakeOrphanedLayers() {
        Texture.all.forEach(tex => {
            if ((tex as any).layers_enabled && (!activeSession || activeSession.texture !== tex)) {
                rebuildSessionFromLayers(tex);
                bakeSession();
            }
        });
    }

    // Auto-bake on texture switch (skip during undo/redo)
    let unwatchTexture: (() => void) | null = null;
    function setupTextureWatcher() {
        if (unwatchTexture) unwatchTexture();
        let vueInst = (UVEditor as any).vue;
        if (vueInst?.$watch) {
            unwatchTexture = vueInst.$watch('texture', () => {
                if (insideUndoRedo) return;
                if (activeSession) bakeSession();
                bakeOrphanedLayers();
            });
        }
    }
    setupTextureWatcher();
    track({
        delete() {
            if (unwatchTexture) unwatchTexture();
        }
    });

    // Auto-bake on mode switch (skip during undo/redo)
    let modeListener = Blockbench.on('select_mode', () => {
        if (insideUndoRedo) return;
        if (activeSession) bakeSession();
        bakeOrphanedLayers();
    });
    track(modeListener);

    // Cleanup on unload
    track({
        delete() {
            try { teardownSession(); } catch (_) { /* ignore */ }
        }
    });
}
