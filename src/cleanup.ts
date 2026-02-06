//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

let list: Deletable[] = [];
export function track(...items: Deletable[]) {
    list.push(...items);
}
export function cleanup() {
    // Delete actions etc. when reloading or uninstalling the plugin
    for (let deletable of list) {
        try {
            deletable.delete();
        } catch (error) {
            console.error(error);
        }
    }
    list.empty();
}