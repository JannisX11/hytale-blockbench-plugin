import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

// Holding SHIFT while painting locks the stroke to a horizontal or vertical line, keeping live pen pressure
export function setupBrushConstrain() {
    let anchor: ArrayVector2 | null = null;
    let axis: 0 | 1 | null = null;
    let last: {x: number, y: number, face: string, element: OutlinerElement} | null = null;
    let stroke_event: Event | null = null;

    function canConstrain(screen_projection: boolean): boolean {
        let tool = Toolbox.selected.id;
        return isHytaleFormat() && Modes.paint
            && (tool == 'brush_tool' || tool == 'eraser')
            && !screen_projection;
    }

    // SHIFT at pen-down starts a constrained stroke instead of joining it to the previous one
    let originalStartPaintTool = Painter.startPaintTool;
    Painter.startPaintTool = function(texture, x, y, uvTag, event, data) {
        let brush: (NonNullable<typeof Toolbox.selected.brush> & {line?: boolean}) | undefined = Toolbox.selected.brush;
        // Same test startPaintTool uses to set Painter.current.use_screen_projection
        let screen_projection = !!data && brush?.screen_space && BarItems.screen_space_brush_projection.value;
        if (!brush || !(event.shiftKey || Pressing.overrides.shift) || !canConstrain(!!screen_projection)) {
            return originalStartPaintTool.call(Painter, texture, x, y, uvTag, event, data);
        }
        let line = brush.line;
        brush.line = false;
        try {
            originalStartPaintTool.call(Painter, texture, x, y, uvTag, event, data);
        } finally {
            if (line === undefined) delete brush.line;
            else brush.line = line;
        }
    }

    // Hide the stock SHIFT line preview to the cursor, since Hytale strokes no longer join
    let unwatch_preview = UVEditor.vue.$watch('mouse_coords.line_preview', (active: boolean) => {
        if (active && canConstrain(false)) UVEditor.vue.mouse_coords.line_preview = false;
    });

    // Dotted guide in the UV editor from the point being painted to the cursor while SHIFT is held
    let guide = document.createElement('div');
    guide.id = 'hytale_brush_constrain_guide';
    let style = Blockbench.addCSS(`
        #hytale_brush_constrain_guide {
            position: absolute;
            pointer-events: none;
            z-index: 3;
            height: 0;
            margin-top: -1px;
            border-top: 2px dotted var(--color-accent);
            transform-origin: 0 0;
        }
    `);
    function updateGuide(texture: Texture, event: PointerEvent) {
        let frame: HTMLElement | undefined = UVEditor.vue.$refs.frame;
        let viewport: HTMLElement | undefined = UVEditor.vue.$refs.viewport;
        // Only for strokes painted in the UV editor, where the cursor and the texture share the frame
        if (!frame || !viewport || UVEditor.vue.texture != texture || !(event.target instanceof Node) || !viewport.contains(event.target)) {
            return hideGuide();
        }
        let rect = frame.getBoundingClientRect();
        let x0 = (Painter.current.x + 0.5) * frame.clientWidth / texture.width;
        let y0 = ((Painter.current.y % texture.display_height) + 0.5) * frame.clientHeight / texture.display_height;
        let x1 = event.clientX - rect.left - frame.clientLeft;
        let y1 = event.clientY - rect.top - frame.clientTop;
        guide.style.left = x0 + 'px';
        guide.style.top = y0 + 'px';
        guide.style.width = Math.hypot(x1 - x0, y1 - y0) + 'px';
        guide.style.transform = `rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`;
        if (guide.parentElement != frame) frame.append(guide);
    }
    function hideGuide() {
        guide.remove();
    }
    document.addEventListener('pointerup', hideGuide);

    // Returns whether the move was constrained
    function moveConstrained(texture: Texture, x: number, y: number, event: PointerEvent, new_face?: boolean, uv?: any): boolean {
        if (stroke_event != Painter.current.start_event) {
            stroke_event = Painter.current.start_event;
            anchor = axis = last = null;
        }
        let constrain = canConstrain(!!Painter.current.use_screen_projection) && (event.shiftKey || Pressing.overrides.shift);

        // Keep a constrained line on its face: revert the caller's switch to the other face
        if (constrain && anchor && last && new_face) {
            Object.assign(Painter.current, last);
            return true;
        }
        // Releasing SHIFT resumes freehand at the cursor, without a line from the locked end
        let resume = axis != null && !constrain;
        if (!constrain || new_face) anchor = axis = null;

        if (constrain && !new_face) {
            if (!anchor) anchor = [Painter.current.x, Painter.current.y];
            if (axis == null) {
                let dx = Math.abs(x - anchor[0]);
                let dy = Math.abs(y - anchor[1]);
                // Wait for a clear direction before locking
                if (Math.max(dx, dy) < 2) return true;
                axis = dx >= dy ? 0 : 1;
            }
            if (axis == 0) y = anchor[1];
            else x = anchor[0];
            // Skip moves that only go across the line, so the end point isn't stamped repeatedly
            if (x == Painter.current.x && y == Painter.current.y) return true;
        }
        originalMovePaintTool.call(Painter, texture, x, y, event, new_face || resume, uv);
        let {face, element} = Painter.current;
        last = {x: Painter.current.x, y: Painter.current.y, face, element};
        return constrain && !new_face;
    }

    let originalMovePaintTool = Painter.movePaintTool;
    Painter.movePaintTool = function(texture, x, y, event, new_face, uv) {
        if (moveConstrained(texture, x, y, event, new_face, uv)) updateGuide(texture, event);
        else hideGuide();
    }

    track(style, {
        delete() {
            unwatch_preview();
            document.removeEventListener('pointerup', hideGuide);
            hideGuide();
            Painter.startPaintTool = originalStartPaintTool;
            Painter.movePaintTool = originalMovePaintTool;
        }
    })
}
