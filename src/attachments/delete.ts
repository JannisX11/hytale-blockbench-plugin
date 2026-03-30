//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { isHytaleFormat } from "../formats";
import { unwatchCollection } from "./watcher";

export function setupDelete() {
	let shared_delete = SharedActions.add('delete', {
		subject: 'collection',
		priority: 1,
		condition: () => Prop.active_panel == 'collections' && isHytaleFormat() && Collection.selected.some(c => c.export_codec === 'blockymodel'),
		run() {
			let collections = Collection.selected.slice();
			let remove_elements: OutlinerElement[] = [];
			let remove_groups: Group[] = [];
			let textures: Texture[] = [];
			let texture_groups: TextureGroup[] = [];

			for (let collection of collections) {
				if (collection.export_codec === 'blockymodel') {
					for (let child of collection.getAllChildren()) {
						child = child as OutlinerNode;
						(child instanceof Group ? remove_groups : remove_elements).safePush(child);
					}

					let texture_group = TextureGroup.all.find(tg => tg.name === collection.name);
					if (texture_group) {
						let textures2 = Texture.all.filter(t => t.group === texture_group.uuid);
						textures.safePush(...textures2);
						texture_groups.push(texture_group);
					}
				}
			}

			Undo.initEdit({
				collections: collections,
				groups: remove_groups,
				elements: remove_elements,
				outliner: true,
				// @ts-expect-error
				texture_groups,
				textures,
			});

			collections.forEach(c => {
				unwatchCollection(c);
				Collection.all.remove(c);
			});
			collections.empty();

			textures.forEach(t => t.remove(true));
			textures.empty();

			texture_groups.forEach(t => t.remove());
			texture_groups.empty();

			remove_groups.forEach(group => group.remove());
			remove_groups.empty();

			remove_elements.forEach(element => element.remove());
			remove_elements.empty();

			updateSelection();
			Undo.finishEdit('Remove attachment');
		}
	});
	track(shared_delete);
}
