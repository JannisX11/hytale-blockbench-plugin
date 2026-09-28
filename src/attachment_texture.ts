//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

declare global {
	interface Texture {
		attachment_texture_groups: string[]
	}
}

import { CustomMenuItem } from "blockbench-types/generated/interface/menu";
import { track } from "./cleanup";
import { FORMAT_IDS, isHytaleFormat } from "./formats";
import { updateUVSize } from "./texture";

export type AttachmentCollection = Collection & {
	texture: string;
}

function getCollection(cube: Cube): AttachmentCollection | undefined {
	return Collection.all.find(c => c.contains(cube)) as AttachmentCollection | undefined;
}

export function processAttachmentTextures(attachmentName: string, newTextures: Texture[]): string {
	let textureGroup = new TextureGroup({ name: attachmentName });
	textureGroup.folded = true;
	textureGroup.add();

	if (newTextures.length === 0) return '';

	for (let tex of newTextures) {
		tex.group = textureGroup.uuid;
		tex.attachment_texture_groups ??= [];
		tex.attachment_texture_groups.safePush(textureGroup.uuid);
		updateUVSize(tex);
	}

	let texture = newTextures.find(t => t.name.startsWith(attachmentName)) ?? newTextures[0];
	return texture.uuid;
}


export function setupAttachmentTextures() {
	let textureProperty = new Property(Collection, 'string', 'texture', {
		condition: { formats: FORMAT_IDS }
	});
	track(textureProperty);

	let originalGetTexture = CubeFace.prototype.getTexture;
	CubeFace.prototype.getTexture = function(...args) {
		if (isHytaleFormat()) {
			if (this.texture == null) return null;
			let collection = getCollection(this.cube);
			if (collection && "texture" in collection) {
				if (collection.texture) {
					let texture = Texture.all.find(t => t.uuid == collection.texture);
					if (texture) return texture;
				}
				return null;
			}
			return Texture.getDefault();
		}
		return originalGetTexture.call(this, ...args);
	};
	track({
		delete() {
			CubeFace.prototype.getTexture = originalGetTexture;
		}
	});

	let groups_property = new Property(Texture, 'array', 'attachment_texture_groups');
	track(groups_property);

    let original_getTextures = TextureGroup.prototype.getTextures;
    TextureGroup.prototype.getTextures = function() {
        if (isHytaleFormat()) {
			return Texture.all.filter(tex => tex.group == this.uuid || tex.attachment_texture_groups?.includes(this.uuid));
        } else {
            return original_getTextures.call(this)
        }
    }
	track({
		delete() {
			TextureGroup.prototype.getTextures = original_getTextures;
		}
	});

	let assignTexture: CustomMenuItem = {
		id: 'set_texture',
		name: 'menu.cube.texture',
		icon: 'collections',
		condition: { formats: FORMAT_IDS },
		children(context: AttachmentCollection) {
			function applyTexture(texture: Texture | null, undoMessage: string) {
				let texture_group = TextureGroup.all.find(tg => tg.name === context.name);
				Undo.initEdit({
					collections: Collection.selected,
					textures: texture && texture_group ? [texture] : undefined
				});
				for (let collection of Collection.selected) {
					// @ts-expect-error
					collection.texture = texture ? texture.uuid : '';
				}
				if (texture && texture_group) {
					texture.attachment_texture_groups.safePush(texture_group.uuid);
					texture.group = texture_group.uuid;
				}
				Undo.finishEdit(undoMessage);
				Canvas.updateAllFaces();
			}

			let arr: CustomMenuItem[] = [
				{
					icon: 'crop_square',
					name: Format.single_texture_default ? 'menu.cube.texture.default' : 'menu.cube.texture.blank',
					click() {
						applyTexture(null, 'Unassign texture from collection');
					}
				}
			];

			Texture.all.forEach(t => {
				arr.push({
					name: t.name,
					icon: t.img,
					marked: t.uuid == context.texture,
					click() {
						applyTexture(t, 'Apply texture to collection');
					}
				});
			});

			return arr;
		}
	};
	Collection.menu.addAction(assignTexture);
	track({
		delete() {
			Collection.menu.removeAction('set_texture');
		}
	});

	let on_finish_edit = Blockbench.on('finish_edit', (arg) => {
		if (!isHytaleFormat()) return;
		if (!arg.aspects.textures || !Undo.current_save?.textures) return;
		let pre_textures = Undo.current_save.textures as Record<string, Texture>;
		for (let texture of arg.aspects.textures) {
			if (!pre_textures[texture.uuid]) continue;
			if (!texture.group && pre_textures[texture.uuid].group) {
				texture.attachment_texture_groups?.empty();
			}
		}
	});
	track(on_finish_edit);
}
