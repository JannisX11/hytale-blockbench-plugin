//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { updateUVSize } from "../texture";

export type AttachmentCollection = Collection & {
	texture: string;
}

function cloneTexture(tex: Texture): Texture {
	let copy = tex.getSaveCopy();
	delete copy.path;
	delete copy.uuid;
	let cloned = new Texture(copy);
	cloned.convertToInternal(tex.getDataURL());
	cloned.load();
	return cloned;
}

function isAttachmentTextureGroup(groupUuid: string): boolean {
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

	// BB deduplicates textures by path in fromPath() (removes duplicate) and add()
	// (returns existing). Both break sharing the same texture across attachment groups.
	let originalRemove = Texture.prototype.remove;
	Texture.prototype.remove = function(this: Texture, ...args: any[]) {
		if (isHytaleFormat() && this.group && isAttachmentTextureGroup(this.group)) {
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

	// Drag-and-drop: clone texture back into its attachment group, send clone to target
	let pendingCloneFixups: Texture[] = [];

	let finishEditListener = Blockbench.on('finish_edit', (event: any) => {
		try {
			if (!isHytaleFormat()) return;
			let aspects = event.aspects;
			let beforeSave = Undo.current_save;
			if (!beforeSave?.textures || !aspects?.textures) return;

			let clones: Texture[] = [];
			for (let tex of aspects.textures) {
				let saved = beforeSave.textures[tex.uuid];
				if (!saved) continue;

				let oldGroup = saved.group;
				if (!oldGroup || oldGroup === tex.group) continue;
				if (!isAttachmentTextureGroup(oldGroup)) continue;

				// Restore original to its attachment group, clone goes to target
				let targetGroup = tex.group;
				tex.group = oldGroup;

				let cloned = cloneTexture(tex);
				cloned.group = targetGroup;
				cloned.add(false);
				clones.push(cloned);

				pendingCloneFixups.push(cloned);
			}
			if (clones.length) {
				aspects.textures.push(...clones);
				Canvas.updateLayeredTextures();
			}
		} catch (e) {
			console.error('[Hytale] texture clone error:', e);
		}
	});
	track(finishEditListener);

	let finishedEditListener = Blockbench.on('finished_edit', (event: any) => {
		if (!isHytaleFormat()) return;

		// Drag-clones are internal, mark saved to hide save icon
		for (let clone of pendingCloneFixups) {
			if (Texture.all.includes(clone)) {
				clone.saved = true;
			}
		}
		pendingCloneFixups.length = 0;

		// Auto-assign imported texture to collection if it has none
		let aspects = event.aspects;
		if (!aspects?.textures) return;
		for (let tex of aspects.textures) {
			if (!tex.group || !isAttachmentTextureGroup(tex.group)) continue;
			let tg = TextureGroup.all.find(tg => tg.uuid === tex.group);
			if (!tg) continue;
			let collection = Collection.all.find(c => c.name === tg.name && c.export_codec === 'blockymodel') as AttachmentCollection | undefined;
			if (!collection || collection.texture) continue;
			collection.texture = tex.uuid;
			Canvas.updateAllFaces();
		}
	});
	track(finishedEditListener);
}
