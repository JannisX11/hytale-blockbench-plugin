//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { BlockymodelJSON } from "../blockymodel";
import { CollectionFolder } from "./collection_folder";
import { assignCollectionScope, isUnloaded } from "./unload";
import { AttachmentCollection, resolveTexturePath } from "./texture";
import { getAttachParent } from "./attach_to";
import { getUniqueAttachmentName } from "./rename";
import { detectHeld, isHeld, setHeld } from "./held";

export type BlockymodelAttachment = {
	name: string
	path: string
	textures: string[]
	primaryTexture: string
	folder?: string
	color?: number
	unloaded?: boolean
	attachTo?: string
	held?: boolean
}
export type BlockymodelFolder = {
	uuid: string
	name: string
	folded: boolean
	order: number
}
type ListedCollection = AttachmentCollection & {
	unloaded: boolean
	unloaded_texture_paths: string
	unloaded_primary_path: string
	folder: string
	color: number
	attach_to: string
}

/** Lists the project's attachments in the main model, with paths relative to it */
export function compileAttachmentList(model: BlockymodelJSON, modelDir: string) {
	let relative = (path: string) => PathModule.relative(modelDir, path).replace(/\\/g, '/');
	let attachments: BlockymodelAttachment[] = [];
	for (let c of Collection.all as ListedCollection[]) {
		if (c.export_codec !== 'blockymodel' || !c.export_path) continue;
		let texPaths: string[] = [];
		let primaryTex = '';

		if (isUnloaded(c)) {
			if (c.unloaded_texture_paths) {
				try {
					let absPaths: string[] = JSON.parse(c.unloaded_texture_paths);
					texPaths = absPaths.map(relative).filter(Boolean);
				} catch {}
			}
			if (c.unloaded_primary_path) primaryTex = relative(c.unloaded_primary_path);
		} else {
			let tg = TextureGroup.all.find(t => t.name === c.name);
			if (tg) {
				texPaths = Texture.all.filter(t => t.group === tg!.uuid)
					.map(t => {
						let p = resolveTexturePath(t);
						return p ? relative(p) : '';
					})
					.filter(Boolean);
			}
			let tex = c.texture && Texture.all.find(t => t.uuid === c.texture);
			let p = tex && resolveTexturePath(tex);
			if (p) primaryTex = relative(p);
		}
		let parentPath = getAttachParent(c)?.export_path;
		attachments.push({
			name: c.name,
			path: relative(c.export_path),
			textures: texPaths,
			primaryTexture: primaryTex,
			folder: c.folder || undefined,
			color: (c.color != null && c.color >= 0) ? c.color : undefined,
			unloaded: isUnloaded(c) || undefined,
			// By path: names may change and need not be unique in older projects
			attachTo: parentPath ? relative(parentPath) : undefined,
			held: isHeld(c),
		});
	}
	if (attachments.length) model.attachments = attachments;
	let folders = CollectionFolder.all.map(f => f.getSaveCopy()) as BlockymodelFolder[];
	if (folders.length) model.attachmentFolders = folders;
}

/** Recreates the project's attachments as unloaded collections */
export function loadAttachmentList(model: BlockymodelJSON, modelDir: string) {
	let fs = requireNativeModule('fs');
	let resolve = (path: string) => PathModule.resolve(modelDir, path);
	let attachments = model.attachments ?? [];
	for (let fd of model.attachmentFolders ?? []) {
		fd.folded = true;
		new CollectionFolder(fd).add();
	}

	for (let att of attachments) {
		let absPath = resolve(att.path);
		if (Collection.all.some(c => c.export_path === absPath)) continue;

		let collection = new Collection({
			name: getUniqueAttachmentName(att.name, absPath),
			children: [],
			export_codec: 'blockymodel',
			visibility: true,
		}).add() as ListedCollection;
		collection.export_path = absPath;
		collection.unloaded = true;
		assignCollectionScope(collection);

		if (att.folder) collection.folder = att.folder;
		if (att.color != null && att.color >= 0) collection.color = att.color;

		collection.unloaded_texture_paths = JSON.stringify(att.textures.map(resolve));
		if (att.primaryTexture) collection.unloaded_primary_path = resolve(att.primaryTexture);

		if (!fs.existsSync(absPath)) {
			Blockbench.showQuickMessage(`Attachment "${att.name}" not found at ${att.path}`, 3000);
		}
		// Projects saved before held items existed
		try {
			setHeld(collection, att.held ?? detectHeld(autoParseJSON(fs.readFileSync(absPath, 'utf-8'), false), absPath));
		} catch {}
	}
	let findByPath = (rel: string) => Collection.all.find(c => c.export_path === resolve(rel)) as ListedCollection | undefined;
	for (let att of attachments) {
		let parent = att.attachTo && findByPath(att.attachTo);
		let collection = findByPath(att.path);
		if (parent && collection) collection.attach_to = parent.uuid;
	}
}
