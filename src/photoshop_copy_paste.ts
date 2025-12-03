import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

export function setupPhotoshopTools() {

    let setting = new Setting('copy_paste_magenta_alpha', {
        name: 'Copy-Paste with Magenta Alpha',
        description: 'Copy image selections with magenta background and remove magenta when pasting to help transfer transparency to Photoshop',
        type: 'toggle',
        value: false
    })
    track(setting);

    let shared_copy = SharedActions.add('copy', {
        subject: 'image_content_photoshop',
        condition: () => Prop.active_panel == 'uv' && Modes.paint && Texture.getDefault() && FORMAT_IDS.includes(Format.id) && setting.value == true,
        priority: 2,
        run(event, cut) {
            let texture = Texture.getDefault();
            let selection = texture.selection;

            let {canvas, ctx, offset} = texture.getActiveCanvas();
            
            if (selection.override != null) {
                Clipbench.image = {
                    x: offset[0], y: offset[1],
                    frame: texture.currentFrame,
                    data: ''
                }
            } else {
                let rect = selection.getBoundingRect();
                let copy_canvas = document.createElement('canvas');
                let copy_ctx = copy_canvas.getContext('2d');
                copy_canvas.width = rect.width;
                copy_canvas.height = rect.height;
                
                selection.maskCanvas(copy_ctx, [rect.start_x, rect.start_y]);
                copy_ctx.drawImage(canvas, -rect.start_x + offset[0], -rect.start_y + offset[1]);

                Clipbench.image = {
                    x: rect.start_x,
                    y: rect.start_y,
                    frame: texture.currentFrame,
                    data: ''
                }
                canvas = copy_canvas;
            }

            // Add pink background
            let canvas_copy_magenta = document.createElement('canvas');
            let copy_ctx_magenta = canvas_copy_magenta.getContext('2d');
            canvas_copy_magenta.width = canvas.width;
            canvas_copy_magenta.height = canvas.height;
            copy_ctx_magenta.fillStyle = '#ff00ff';
            copy_ctx_magenta.fillRect(0, 0, canvas.width, canvas.height);
            copy_ctx_magenta.drawImage(canvas, 0, 0);
            canvas = canvas_copy_magenta;  

            Clipbench.image.data = canvas.toDataURL('image/png', 1);

            if (isApp) {
                let clipboard = requireNativeModule('clipboard');
                // @ts-expect-error
                let img = nativeImage.createFromDataURL(Clipbench.image.data);
                clipboard.writeImage(img);
            } else {
                canvas.toBlob(blob => {
                    navigator.clipboard.write([
                        new ClipboardItem({
                            [blob.type]: blob,
                        }),
                    ]);
                });
            }

            if (cut) {
                SharedActions.runSpecific('delete', 'image_content', event, {message: 'Cut texture selection'});
            }
        }
    })
    track(shared_copy);
    let shared_paste = SharedActions.add('paste', {
        subject: 'image_content_photoshop',
        condition: () => Prop.active_panel == 'uv' && Modes.paint && Texture.getDefault() && FORMAT_IDS.includes(Format.id) && setting.value == true,
        priority: 2,
        run(event) {

            let texture = Texture.getDefault();

            async function loadFromDataUrl(data_url: string) {
                let frame = new CanvasFrame();
                await frame.loadFromURL(data_url);

                Undo.initEdit({textures: [texture], bitmap: true});
                if (!texture.layers_enabled) {
                    texture.flags.add('temporary_layers');
                    texture.activateLayers(false);
                }
                let offset;
                if (Clipbench.image) {
                    offset = [Math.clamp(Clipbench.image.x, 0, texture.width), Math.clamp(Clipbench.image.y, 0, texture.height)];
                    offset[0] = Math.clamp(offset[0], 0, texture.width-frame.width);
                    offset[1] = Math.clamp(offset[1], 0, texture.height-frame.height);
                }
                let old_frame = Clipbench.image?.frame || 0;
                if (old_frame || texture.currentFrame) {
                    offset[1] += texture.display_height * ((texture.currentFrame||0) - old_frame);
                }
                let layer = new TextureLayer({name: 'pasted', offset}, texture);
                let image_data = frame.ctx.getImageData(0, 0, frame.width, frame.height);

                // Filter magenta
                for (let i = 0; i < image_data.data.length; i += 4) {
                    if (image_data.data[i] == 255 && image_data.data[i+1] == 0 && image_data.data[i+2] == 255) {
                        image_data.data[i+0] = 0;
                        image_data.data[i+1] = 0;
                        image_data.data[i+2] = 0;
                        image_data.data[i+3] = 0;
                    }
                }


                layer.setSize(frame.width, frame.height);
                layer.ctx.putImageData(image_data, 0, 0);
                if (!offset) layer.center();

                layer.addForEditing();
                layer.setLimbo();
                texture.updateChangesAfterEdit();

                Undo.finishEdit('Paste into texture');
                if (Toolbox.selected.id != 'selection_tool') (BarItems.move_layer_tool as Tool).select();
                updateInterfacePanels();
                BARS.updateConditions();
            }
            
        
            if (isApp) {
                let clipboard = requireNativeModule('clipboard');
                var image = clipboard.readImage().toDataURL();
                loadFromDataUrl(image);
            } else {
                navigator.clipboard.read().then(content => {
                    if (content && content[0] && content[0].types.includes('image/png')) {
                        content[0].getType('image/png').then(blob => {
                            let url = URL.createObjectURL(blob);
                            loadFromDataUrl(url);
                        })
                    }
                }).catch(() => {})
            }
            
        }
    });
    track(shared_paste);
}
