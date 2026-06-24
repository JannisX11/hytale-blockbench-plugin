//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { updateUVSize } from "../texture";
import { cloneTexture, syncFromSiblings } from "../clone_texture";

export type AttachmentCollection = Collection & {
	texture: string;
}

export function resolveTexturePath(tex: Texture): string {
	if (tex.path) return tex.path;
	if ((tex as any).source_path) return (tex as any).source_path;
	let source = Texture.all.find(s => s.name === tex.name && s.path && s.uuid !== tex.uuid);
	return source?.path || '';
}

export function isAttachmentTextureGroup(groupUuid: string): boolean {
	let tg = TextureGroup.all.find(tg => tg.uuid === groupUuid);
	if (!tg) return false;
	return Collection.all.some(c => c.name === tg.name && c.export_codec === 'blockymodel');
}

export function getCollection(cube: Cube): AttachmentCollection | undefined {
	return Collection.all.find(c => c.contains(cube)) as AttachmentCollection | undefined;
}

// Clone textures that already belong to another group so each attachment gets its own copy
export function processAttachmentTextures(attachmentName: string, newTextures: Texture[]): string {
	let textureGroup = new TextureGroup({ name: attachmentName });
	textureGroup.folded = true;
	textureGroup.add();

	if (newTextures.length === 0) return '';

	for (let i = 0; i < newTextures.length; i++) {
		let tex = newTextures[i];
		if (tex.group && tex.group !== textureGroup.uuid) {
			let cloned = cloneTexture(tex);
			cloned.add(false);
			tex = cloned;
			newTextures[i] = cloned;
		}
		tex.group = textureGroup.uuid;
		syncFromSiblings(tex);
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

	// Resolve texture per-collection instead of per-face
	let originalGetTexture = CubeFace.prototype.getTexture;
	CubeFace.prototype.getTexture = function(...args) {
		if (isHytaleFormat()) {
			let collection = getCollection(this.cube);
			if (collection && "texture" in collection) {
				if (collection.texture) {
					let texture = Texture.all.find(t => t.uuid == collection.texture);
					if (texture) return texture;
				}
				return null;
			}
			if (this.texture == null) return null;
			return Texture.getDefault();
		}
		return originalGetTexture.call(this, ...args);
	};
	track({
		delete() {
			CubeFace.prototype.getTexture = originalGetTexture;
		}
	});

	// BB deduplicates textures by path in fromPath() (removes duplicate) and add()
	// (returns existing). Both break sharing the same texture across attachment groups.
	let isDedupRemove = false;

	let originalFromPath = Texture.prototype.fromPath;
	Texture.prototype.fromPath = function(this: Texture, ...args: any[]) {
		if (isHytaleFormat()) {
			isDedupRemove = true;
			try {
				return originalFromPath.apply(this, args);
			} finally {
				isDedupRemove = false;
			}
		}
		return originalFromPath.apply(this, args);
	};
	track({
		delete() {
			Texture.prototype.fromPath = originalFromPath;
		}
	});

	let originalRemove = Texture.prototype.remove;
	Texture.prototype.remove = function(this: Texture, ...args: any[]) {
		if (isDedupRemove && this.group && isAttachmentTextureGroup(this.group)) {
			return;
		}
		return originalRemove.apply(this, args);
	};
	track({
		delete() {
			Texture.prototype.remove = originalRemove;
		}
	});

	let originalAdd = Texture.prototype.add;
	Texture.prototype.add = function(this: Texture, ...args: any[]) {
		if (isHytaleFormat() && this.path) {
			let savedPath = this.path;
			this.path = '';
			let result = originalAdd.apply(this, args);
			this.path = savedPath;
			return result;
		}
		return originalAdd.apply(this, args);
	};
	track({
		delete() {
			Texture.prototype.add = originalAdd;
		}
	});

	// "Set Texture" submenu on collection right-click
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
