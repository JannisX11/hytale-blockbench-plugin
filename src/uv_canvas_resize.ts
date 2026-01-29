//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";
import { AttachmentCollection } from "./attachment_texture";

interface CropBounds { left: number; top: number; right: number; bottom: number; }
type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

const CROP_CSS = `
.uv_crop_overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 20;
}
.uv_crop_box {
    position: absolute;
    border: 2px dashed var(--color-accent);
    box-sizing: border-box;
    pointer-events: auto;
    cursor: move;
}
.uv_crop_shade {
    position: absolute;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: none;
}
.uv_crop_handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--color-accent);
    border: 1px solid var(--color-light);
    box-sizing: border-box;
    pointer-events: auto;
}
.uv_crop_handle.corner { width: 12px; height: 12px; }
.uv_crop_handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
.uv_crop_handle.n { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.uv_crop_handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
.uv_crop_handle.e { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.uv_crop_handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
.uv_crop_handle.s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.uv_crop_handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.uv_crop_handle.w { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
.uv_crop_grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.uv_crop_grid_line {
    position: absolute;
    background: rgba(255, 255, 255, 0.3);
}
.uv_crop_grid_line.h1 { top: 33.33%; left: 0; right: 0; height: 1px; }
.uv_crop_grid_line.h2 { top: 66.66%; left: 0; right: 0; height: 1px; }
.uv_crop_grid_line.v1 { left: 33.33%; top: 0; bottom: 0; width: 1px; }
.uv_crop_grid_line.v2 { left: 66.66%; top: 0; bottom: 0; width: 1px; }
.uv_crop_width {
    position: absolute;
    top: 0;
    left: 50%;
    color: var(--color-light);
    font-size: 24px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    transform-origin: center bottom;
}
.uv_crop_height {
    position: absolute;
    left: 0;
    top: 50%;
    color: var(--color-light);
    font-size: 24px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    transform-origin: right center;
}
`;

// Photoshop-style crop tool for resizing UV canvas with handles and snapping
class UVCropTool {
    private overlay: HTMLElement | null = null;
    private cropBox: HTMLElement | null = null;
    private uvFrame: HTMLElement | null = null;
    private bounds: CropBounds = { left: 0, top: 0, right: 64, bottom: 64 };
    private dragging: HandleType | null = null;
    private dragStart = { x: 0, y: 0 };
    private boundsStart: CropBounds = { left: 0, top: 0, right: 0, bottom: 0 };
    private texture: Texture | null = null;
    private active = false;
    private unwatchers: (() => void)[] = [];

    activate() {
        this.texture = Texture.getDefault();
        if (!this.texture) {
            Blockbench.showQuickMessage('No texture selected', 2000);
            return;
        }

        this.uvFrame = Panels.uv?.node?.querySelector('#uv_frame') as HTMLElement;
        if (!this.uvFrame) {
            Blockbench.showQuickMessage('UV panel not found', 2000);
            return;
        }

        this.active = true;
        this.bounds = { left: 0, top: 0, right: this.texture.uv_width, bottom: this.texture.uv_height };

        this.createOverlay();
        this.updateDisplay();
        this.addEventListeners();
    }

    deactivate() {
        if (!this.active) return;
        this.active = false;
        this.removeOverlay();
        this.removeEventListeners();
        this.hideQuickMessage();
    }

    private createOverlay() {
        if (!this.uvFrame) return;

        this.overlay = document.createElement('div');
        this.overlay.className = 'uv_crop_overlay';

        for (const pos of ['top', 'right', 'bottom', 'left']) {
            const shade = document.createElement('div');
            shade.className = `uv_crop_shade shade_${pos}`;
            this.overlay.appendChild(shade);
        }

        this.cropBox = document.createElement('div');
        this.cropBox.className = 'uv_crop_box';
        this.cropBox.innerHTML = `
            <div class="uv_crop_grid">
                <div class="uv_crop_grid_line h1"></div>
                <div class="uv_crop_grid_line h2"></div>
                <div class="uv_crop_grid_line v1"></div>
                <div class="uv_crop_grid_line v2"></div>
            </div>
            <div class="uv_crop_handle corner nw" data-handle="nw"></div>
            <div class="uv_crop_handle n" data-handle="n"></div>
            <div class="uv_crop_handle corner ne" data-handle="ne"></div>
            <div class="uv_crop_handle e" data-handle="e"></div>
            <div class="uv_crop_handle corner se" data-handle="se"></div>
            <div class="uv_crop_handle s" data-handle="s"></div>
            <div class="uv_crop_handle corner sw" data-handle="sw"></div>
            <div class="uv_crop_handle w" data-handle="w"></div>
            <div class="uv_crop_width"></div>
            <div class="uv_crop_height"></div>
        `;

        this.overlay.appendChild(this.cropBox);
        this.uvFrame.appendChild(this.overlay);
        Blockbench.showQuickMessage('Press Enter to crop\nPress Esc to cancel', 3600000);
    }

    private hideQuickMessage() {
        const el = document.getElementById('quick_message_box');
        if (el) el.style.display = 'none';
    }

    private removeOverlay() {
        this.overlay?.remove();
        this.overlay = null;
        this.cropBox = null;
    }

    private getScale(): number {
        const vue = UVEditor.vue as any;
        return vue?.inner_width / (this.texture?.uv_width || 64) || 1;
    }

    private getInnerOffset(): { x: number; y: number } {
        const vue = UVEditor.vue as any;
        return { x: vue?.inner_left || 0, y: vue?.inner_top || 0 };
    }

    private uvToScreen(uvX: number, uvY: number): { x: number; y: number } {
        const scale = this.getScale();
        const offset = this.getInnerOffset();
        return { x: offset.x + uvX * scale, y: offset.y + uvY * scale };
    }

    private updateDisplay() {
        if (!this.overlay || !this.cropBox || !this.uvFrame) return;

        const topLeft = this.uvToScreen(this.bounds.left, this.bounds.top);
        const bottomRight = this.uvToScreen(this.bounds.right, this.bounds.bottom);
        const left = topLeft.x, top = topLeft.y;
        const width = bottomRight.x - topLeft.x, height = bottomRight.y - topLeft.y;

        Object.assign(this.cropBox.style, {
            left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
        });

        const frameWidth = this.uvFrame.clientWidth;
        const frameHeight = this.uvFrame.clientHeight;

        const shades = {
            top: { left: '0', top: '0', right: '0', height: `${Math.max(0, top)}px` },
            bottom: { left: '0', bottom: '0', right: '0', height: `${Math.max(0, frameHeight - top - height)}px` },
            left: { left: '0', top: `${Math.max(0, top)}px`, width: `${Math.max(0, left)}px`, height: `${height}px` },
            right: { right: '0', top: `${Math.max(0, top)}px`, width: `${Math.max(0, frameWidth - left - width)}px`, height: `${height}px` }
        };

        for (const [pos, styles] of Object.entries(shades)) {
            const el = this.overlay.querySelector(`.shade_${pos}`) as HTMLElement;
            if (el) Object.assign(el.style, styles);
        }

        // Dimension labels - inverse scale keeps them readable at any zoom
        const uvFactor = this.texture ? this.texture.width / this.texture.uv_width : 1;
        const pixelWidth = Math.round((this.bounds.right - this.bounds.left) * uvFactor);
        const pixelHeight = Math.round((this.bounds.bottom - this.bounds.top) * uvFactor);
        const scale = this.getScale();
        const inverseScale = 1 / scale;

        const widthEl = this.cropBox.querySelector('.uv_crop_width') as HTMLElement;
        if (widthEl) {
            widthEl.textContent = `${pixelWidth}px`;
            widthEl.style.transform = `translateX(-50%) translateY(calc(-100% - 8px)) scale(${inverseScale})`;
        }

        const heightEl = this.cropBox.querySelector('.uv_crop_height') as HTMLElement;
        if (heightEl) {
            heightEl.textContent = `${pixelHeight}px`;
            heightEl.style.transform = `translateX(calc(-100% - 8px)) translateY(-50%) scale(${inverseScale})`;
        }
    }

    private handleMouseDown = (e: MouseEvent) => {
        if (!this.active) return;
        const target = e.target as HTMLElement;

        if (target.classList.contains('uv_crop_handle')) {
            this.dragging = target.dataset.handle as HandleType;
        } else if (target.classList.contains('uv_crop_box') || target.closest('.uv_crop_box')) {
            if (target.tagName === 'BUTTON') return;
            this.dragging = 'move';
        } else {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.boundsStart = { ...this.bounds };

        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    };

    private handleMouseMove = (e: MouseEvent) => {
        if (!this.dragging || !this.texture) return;

        const scale = this.getScale();
        const dx = (e.clientX - this.dragStart.x) / scale;
        const dy = (e.clientY - this.dragStart.y) / scale;
        const minSize = 1;
        const b = this.boundsStart;

        const handlers: Record<HandleType, () => void> = {
            move: () => { this.bounds = { left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy }; },
            nw: () => { this.bounds.left = Math.min(b.left + dx, b.right - minSize); this.bounds.top = Math.min(b.top + dy, b.bottom - minSize); },
            n: () => { this.bounds.top = Math.min(b.top + dy, b.bottom - minSize); },
            ne: () => { this.bounds.right = Math.max(b.right + dx, b.left + minSize); this.bounds.top = Math.min(b.top + dy, b.bottom - minSize); },
            e: () => { this.bounds.right = Math.max(b.right + dx, b.left + minSize); },
            se: () => { this.bounds.right = Math.max(b.right + dx, b.left + minSize); this.bounds.bottom = Math.max(b.bottom + dy, b.top + minSize); },
            s: () => { this.bounds.bottom = Math.max(b.bottom + dy, b.top + minSize); },
            sw: () => { this.bounds.left = Math.min(b.left + dx, b.right - minSize); this.bounds.bottom = Math.max(b.bottom + dy, b.top + minSize); },
            w: () => { this.bounds.left = Math.min(b.left + dx, b.right - minSize); }
        };

        handlers[this.dragging]();
        this.snapToEdges();
        this.updateDisplay();
    };

    // Magnetic snap to original canvas edges
    private snapToEdges() {
        if (!this.texture) return;

        const snapThreshold = 3; // UV units
        const edges = { left: 0, top: 0, right: this.texture.uv_width, bottom: this.texture.uv_height };

        if (Math.abs(this.bounds.left - edges.left) < snapThreshold) this.bounds.left = edges.left;
        if (Math.abs(this.bounds.left - edges.right) < snapThreshold) this.bounds.left = edges.right;
        if (Math.abs(this.bounds.right - edges.left) < snapThreshold) this.bounds.right = edges.left;
        if (Math.abs(this.bounds.right - edges.right) < snapThreshold) this.bounds.right = edges.right;
        if (Math.abs(this.bounds.top - edges.top) < snapThreshold) this.bounds.top = edges.top;
        if (Math.abs(this.bounds.top - edges.bottom) < snapThreshold) this.bounds.top = edges.bottom;
        if (Math.abs(this.bounds.bottom - edges.top) < snapThreshold) this.bounds.bottom = edges.top;
        if (Math.abs(this.bounds.bottom - edges.bottom) < snapThreshold) this.bounds.bottom = edges.bottom;
    }

    private handleMouseUp = () => {
        this.dragging = null;
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        if (!this.active) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            this.apply();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.deactivate();
        }
    };

    private addEventListeners() {
        this.overlay?.addEventListener('mousedown', this.handleMouseDown);
        this.uvFrame?.addEventListener('wheel', () => this.updateDisplay());
        document.addEventListener('keydown', this.handleKeyDown);

        const vue = UVEditor.vue as any;
        if (vue?.$watch) {
            for (const prop of ['zoom', 'inner_left', 'inner_top']) {
                this.unwatchers.push(vue.$watch(prop, () => this.updateDisplay()));
            }
        }
    }

    private removeEventListeners() {
        this.overlay?.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('keydown', this.handleKeyDown);
        this.unwatchers.forEach(fn => fn());
        this.unwatchers = [];
    }

    // Crops textures and adjusts UVs based on context (attachment vs main model)
    private apply() {
        if (!this.texture) return;

        const selectedTexture = this.texture;

        // Determine context: if texture belongs to attachment, only affect that attachment
        const collectionsUsingTexture = Collection.all.filter(c =>
            (c as AttachmentCollection).texture === selectedTexture.uuid
        );
        const isAttachmentTexture = collectionsUsingTexture.length > 0;

        let texturesToCrop: Texture[];
        let elementsToAffect: OutlinerElement[];

        if (isAttachmentTexture) {
            texturesToCrop = [selectedTexture];
            elementsToAffect = Outliner.elements.filter(el =>
                collectionsUsingTexture.some(c => c.contains(el))
            );
        } else {
            // Main model: affect all textures not assigned to any collection
            const collectionTextureUuids = new Set(
                Collection.all.map(c => (c as AttachmentCollection).texture).filter(Boolean)
            );
            texturesToCrop = Texture.all.filter(t => !collectionTextureUuids.has(t.uuid));
            elementsToAffect = Outliner.elements.filter(el =>
                !Collection.all.some(c => c.contains(el))
            );
        }

        if (texturesToCrop.length === 0) {
            Blockbench.showQuickMessage('No textures to crop', 2000);
            return;
        }

        const refUvFactor = selectedTexture.width / selectedTexture.uv_width;
        const newWidth = Math.round((this.bounds.right - this.bounds.left) * refUvFactor);
        const newHeight = Math.round((this.bounds.bottom - this.bounds.top) * refUvFactor);

        if (newWidth < 1 || newHeight < 1) {
            Blockbench.showQuickMessage('Invalid crop size', 2000);
            return;
        }

        Undo.initEdit({ textures: texturesToCrop, bitmap: true });

        for (const texture of texturesToCrop) {
            const uvFactor = texture.width / texture.uv_width;
            const pixelLeft = Math.round(this.bounds.left * uvFactor);
            const pixelTop = Math.round(this.bounds.top * uvFactor);
            const pixelWidth = Math.round((this.bounds.right - this.bounds.left) * uvFactor);
            const pixelHeight = Math.round((this.bounds.bottom - this.bounds.top) * uvFactor);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = texture.width;
            tempCanvas.height = texture.height;
            tempCanvas.getContext('2d')!.drawImage(texture.img, 0, 0);

            texture.width = (texture as any).canvas.width = pixelWidth;
            texture.height = (texture as any).canvas.height = pixelHeight;

            const ctx = (texture as any).ctx as CanvasRenderingContext2D;
            ctx.clearRect(0, 0, pixelWidth, pixelHeight);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, -pixelLeft, -pixelTop);

            texture.uv_width = pixelWidth / uvFactor;
            texture.uv_height = pixelHeight / uvFactor;
            (texture as any).updateChangesAfterEdit();
        }

        Undo.finishEdit(isAttachmentTexture ? 'Crop attachment texture' : 'Crop model textures');

        // Shift UVs so elements stay mapped to the same visual area
        const cubes = elementsToAffect.filter((el): el is Cube => el instanceof Cube && !!el.faces);

        if (cubes.length) {
            Undo.initEdit({ elements: cubes });

            const offsetX = this.bounds.left;
            const offsetY = this.bounds.top;

            for (const cube of cubes) {
                if (cube.box_uv) {
                    cube.uv_offset[0] -= offsetX;
                    cube.uv_offset[1] -= offsetY;
                } else {
                    for (const key in cube.faces) {
                        const uv = cube.faces[key as CubeFaceDirection].uv;
                        uv[0] -= offsetX;
                        uv[1] -= offsetY;
                        uv[2] -= offsetX;
                        uv[3] -= offsetY;
                    }
                }
            }

            Canvas.updateView({ elements: cubes, element_aspects: { uv: true } });
            Undo.finishEdit('Adjust UV after cropping');
        }

        UVEditor.vue.$forceUpdate();
        this.deactivate();
    }
}

let cropTool: UVCropTool | null = null;

export function setupUVCanvasResize() {
    const style = Blockbench.addCSS(CROP_CSS);
    track(style);

    cropTool = new UVCropTool();

    const action = new Action('hytale_resize_uv_canvas', {
        name: 'Resize UV Canvas',
        icon: 'crop',
        category: 'uv',
        condition: { formats: FORMAT_IDS },
        click: () => cropTool?.activate()
    });
    track(action);

    MenuBar.menus.edit.addAction(action, '5');

    track(Blockbench.on('select_project', () => cropTool?.deactivate()));
    track({ delete: () => { cropTool?.deactivate(); cropTool = null; } });
}
