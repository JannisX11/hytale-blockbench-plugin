//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

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
		// @ts-expect-error
		tex.group = textureGroup.uuid;
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
		}
		return originalGetTexture.call(this, ...args);
	};
	track({
		delete() {
			CubeFace.prototype.getTexture = originalGetTexture;
		}
	});

	let assignTexture: CustomMenuItem = {
		id: 'set_texture',
		name: 'menu.cube.texture',
		icon: 'collections',
		condition: { formats: FORMAT_IDS },
		children(context: AttachmentCollection) {
			function applyTexture(textureValue: string, undoMessage: string) {
				Undo.initEdit({ collections: Collection.selected });
				for (let collection of Collection.selected) {
					// @ts-expect-error
					collection.texture = textureValue;
				}
				Undo.finishEdit(undoMessage);
				Canvas.updateAllFaces();
			}

			let arr: CustomMenuItem[] = [
				{
					icon: 'crop_square',
					name: Format.single_texture_default ? 'menu.cube.texture.default' : 'menu.cube.texture.blank',
					click() {
						applyTexture('', 'Unassign texture from collection');
					}
				}
			];

			Texture.all.forEach(t => {
				arr.push({
					name: t.name,
					// @ts-expect-error
					icon: t.img,
					marked: t.uuid == context.texture,
					click() {
						applyTexture(t.uuid, 'Apply texture to collection');
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
}
