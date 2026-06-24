//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";
import { AttachmentCollection, isAttachmentTextureGroup, resolveTexturePath } from "./attachments/texture";

export function cloneTexture(tex: Texture): Texture {
	let copy = tex.getSaveCopy();
	delete copy.path;
	delete copy.uuid;
	let cloned = new Texture(copy);
	cloned.convertToInternal(tex.getDataURL());
	cloned.load();
	let sourcePath = tex.path || (tex as any).source_path;
	if (sourcePath) (cloned as any).source_path = sourcePath;
	return cloned;
}

function getTextureSiblings(tex: Texture): Texture[] {
	let path = resolveTexturePath(tex);
	if (!path) return [];
	return Texture.all.filter(t => t.uuid !== tex.uuid && resolveTexturePath(t) === path);
}

function syncSavedState(source: Texture) {
	let changed = false;
	for (let sibling of getTextureSiblings(source)) {
		if (sibling.saved !== source.saved) {
			sibling.saved = source.saved;
			changed = true;
		}
	}
	if (changed) Panels.textures.inside_vue.$forceUpdate();
}

function applySiblingSync(tex: Texture, edited: Texture) {
	tex.canvas.width = edited.canvas.width;
	tex.canvas.height = edited.canvas.height;
	tex.ctx.drawImage(edited.canvas, 0, 0);
	tex.source = tex.canvas.toDataURL();
	tex.updateImageFromCanvas();
	tex.saved = false;
	Panels.textures.inside_vue.$forceUpdate();
}

// Copy canvas pixels from an existing sibling that has unsaved edits
export function syncFromSiblings(tex: Texture) {
	let siblings = getTextureSiblings(tex);
	let edited = siblings.find(s => !s.saved);
	if (!edited) return;
	// Defer until after img.onload populates the canvas from disk
	let origOnload = tex.img.onload;
	tex.img.onload = function(this: any, ...args: any[]) {
		if (origOnload) origOnload.apply(this, args);
		applySiblingSync(tex, edited);
	};
}

export function setupCloneTexture() {
	// Live sync: copy paint strokes across all cloned texture siblings
	let editTextureListener = Blockbench.on('edit_texture', (event: any) => {
		if (!isHytaleFormat()) return;
		let tex = event.texture as Texture;
		let siblings = getTextureSiblings(tex);
		for (let sibling of siblings) {
			sibling.canvas.width = tex.canvas.width;
			sibling.canvas.height = tex.canvas.height;
			sibling.ctx.drawImage(tex.canvas, 0, 0);
			sibling.getOwnMaterial().map.needsUpdate = true;
		}
	});
	track(editTextureListener);

	// Full sync at stroke end: update source, thumbnail, and saved status on siblings
	let paintEndListener = Blockbench.on('finished_edit', (event: any) => {
		if (!isHytaleFormat()) return;
		let aspects = event.aspects;
		if (!aspects?.textures) return;
		for (let tex of aspects.textures) {
			if (tex.saved) continue;
			let siblings = getTextureSiblings(tex);
			for (let sibling of siblings) {
				sibling.canvas.width = tex.canvas.width;
				sibling.canvas.height = tex.canvas.height;
				sibling.ctx.drawImage(tex.canvas, 0, 0);
				sibling.source = sibling.canvas.toDataURL();
				sibling.updateImageFromCanvas();
				sibling.saved = false;
			}
			if (siblings.length) Panels.textures.inside_vue.$forceUpdate();
		}
	});
	track(paintEndListener);

	// Sync saved=true when a texture is saved
	let originalSave = Texture.prototype.save;
	Texture.prototype.save = function(this: Texture, ...args: any[]) {
		let result = originalSave.apply(this, args);
		if (isHytaleFormat() && this.saved) {
			syncSavedState(this);
		}
		return result;
	};
	track({
		delete() {
			Texture.prototype.save = originalSave;
		}
	});

	let cloneKeybind = new KeybindItem('hytale_clone_texture_modifier', {
		name: 'Duplicate Texture on Drop',
		description: 'Hold this key while dropping a texture to duplicate it instead of moving',
		keybind: new Keybind({ key: 18 }),
		category: 'textures'
	});
	track(cloneKeybind);

	let cloneModifierHeld = false;
	function onCloneKeyDown(e: KeyboardEvent) {
		let kb = cloneKeybind.keybind;
		if (e.keyCode === kb.key || (e.key === 'Alt' && (kb.key === 18 || kb.alt))) {
			cloneModifierHeld = true;
		}
	}
	function onCloneKeyUp(e: KeyboardEvent) {
		let kb = cloneKeybind.keybind;
		if (e.keyCode === kb.key || (e.key === 'Alt' && (kb.key === 18 || kb.alt))) {
			cloneModifierHeld = false;
		}
	}
	document.addEventListener('keydown', onCloneKeyDown, true);
	document.addEventListener('keyup', onCloneKeyUp, true);
	track({ delete() {
		document.removeEventListener('keydown', onCloneKeyDown, true);
		document.removeEventListener('keyup', onCloneKeyUp, true);
	}});

	let pendingCloneFixups: Texture[] = [];

	let finishEditListener = Blockbench.on('finish_edit', (event: any) => {
		try {
			if (!isHytaleFormat() || !cloneModifierHeld) return;
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
