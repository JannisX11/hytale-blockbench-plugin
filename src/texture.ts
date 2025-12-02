export function updateUVSize(texture: Texture) {
    let size = [texture.width, texture.display_height];
    let frames = texture.frameCount;
    if (settings.detect_flipbook_textures.value == false || frames <= 2 || (frames%1)) {
        size[1] = texture.height;
    }
    console.log('update', texture.name, texture, size)
    texture.uv_width = size[0];
    texture.uv_height = size[1];
}
