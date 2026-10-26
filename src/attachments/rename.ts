//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";

/** Attachment names identify collections, root prefixes and texture groups, so keep them unique */
export function getUniqueAttachmentName(name: string, path?: string, self?: Collection): string {
	let taken = (candidate: string) => Collection.all.some(c => c !== self && c.export_codec === 'blockymodel' && c.name === candidate);
	if (!taken(name)) return name;
	let folder = path ? PathModule.basename(PathModule.dirname(path)) : '';
	if (folder && !taken(`${folder} ${name}`)) return `${folder} ${name}`;
	let i = 2;
	while (taken(`${name} (${i})`)) i++;
	return `${name} (${i})`;
}

/** Keeps the "Attachment:" root group prefix and the texture group name in sync when an attachment is renamed */
export function setupAttachmentRename() {
	let listener = Blockbench.on('edit_collection_properties', ({collection}: {collection: Collection}) => {
		if (!isHytaleFormat() || collection.export_codec !== 'blockymodel') return;
		collection.name = getUniqueAttachmentName(collection.name, undefined, collection);
		let prefix = collection.name + ':';
		let stale = collection.getChildren().filter((node): node is Group => {
			return node instanceof Group && node.name.includes(':') && !node.name.startsWith(prefix);
		});
		if (!stale.length) return;
		let old_name = stale[0].name.replace(/:[^:]*$/, '');
		let texture_group = TextureGroup.all.find(tg => tg.name === old_name);

		// Fires inside the dialog's undo edit, so record the old state before renaming
		let save = Undo.current_save as (UndoSave & { texture_groups?: Record<string, object> }) | undefined;
		if (save) {
			save.aspects.groups = [...(save.aspects.groups ?? []), ...stale];
			save.groups = [...(save.groups ?? []), ...stale.map(group => {
				let copy = group.getChildlessCopy();
				copy.uuid = group.uuid;
				return copy;
			})];
			if (texture_group) {
				save.aspects.texture_groups = [...(save.aspects.texture_groups ?? []), texture_group];
				save.texture_groups = {...(save.texture_groups ?? {}), [texture_group.uuid]: texture_group.getUndoCopy()};
			}
		}
		for (let group of stale) {
			group.name = prefix + group.name.replace(/^.+:/, '');
		}
		if (texture_group) texture_group.name = collection.name;
	});
	track(listener);
}
