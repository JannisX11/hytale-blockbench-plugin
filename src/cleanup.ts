let list: Deletable[] = [];
export function track(...items: Deletable[]) {
    list.push(...items);
}
export function cleanup() {
    // Delete actions etc. when reloading or uninstalling the plugin
    for (let deletable of list) {
        deletable.delete();
    }
    list.empty();
}