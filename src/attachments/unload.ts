//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { discoverTexturePaths } from "../blockymodel";
import { AttachmentCollection } from "./texture";
import { unwatchCollection, watchCollection } from "./watcher";
import { CollectionFolder, scheduleFolderUpdate } from "./collection_folder";

type UnloadedCollection = Collection & {
    unloaded: boolean;
    unloaded_texture_paths: string;
    unloaded_primary_path: string;
};

interface UnloadedState {
    json: any;
    texturePaths: string[];
    primaryTexturePath: string;
}

const unloadedStates = new Map<string, UnloadedState>();
const UNLOADED_ATTR = 'data-hytale-unloaded';

function setUnloadedAttr(collection: Collection, unloaded: boolean) {
    let list = Panels.collections?.node?.querySelector('#collections_list');
    let el = list?.querySelector(`[uuid="${collection.uuid}"]`) as HTMLElement | null;
    if (!el) return;
    if (unloaded) el.setAttribute(UNLOADED_ATTR, '');
    else el.removeAttribute(UNLOADED_ATTR);
}

export function assignCollectionScope(collection: Collection) {
    let usedScopes = new Set<number>();
    for (let node of (Group.all as OutlinerNode[]).concat(Outliner.elements)) {
        usedScopes.add(node.scope);
    }
    for (let c of Collection.all) usedScopes.add(c.scope);
    let scope = 1;
    while (usedScopes.has(scope)) scope++;
    // Collect children via UUID lookup before setting scope on the collection,
    // because getAllChildren() switches to scope-based filtering when scope > 0
    let children: OutlinerNode[] = collection.children
        .map((uuid: string) => OutlinerNode.uuids[uuid])
        .filter(Boolean);
    let allChildren: OutlinerNode[] = [];
    for (let child of children) {
        allChildren.push(child);
        if ('forEachChild' in child && typeof child.forEachChild === 'function') {
            (child as Group).forEachChild((sub: OutlinerNode) => allChildren.push(sub));
        }
    }
    for (let child of allChildren) {
        child.scope = scope;
    }
    collection.scope = scope;
}

export function isUnloaded(collection: Collection): boolean {
    return (collection as UnloadedCollection).unloaded === true;
}

export function unloadCollection(collection: Collection) {
    if (isUnloaded(collection)) return;
    if (collection.export_codec !== 'blockymodel') return;

    let savedState = collection.saved;

    let json = Codecs.blockymodel.compile({ attachment: collection, raw: true });

    let texturePaths: string[] = [];
    let primaryTexturePath = '';
    let primaryUuid = (collection as AttachmentCollection).texture || '';
    if (primaryUuid) {
        let pt = Texture.all.find(t => t.uuid === primaryUuid);
        if (pt?.path) primaryTexturePath = pt.path;
    }
    let tg = TextureGroup.all.find(t => t.name === collection.name);
    if (tg) {
        let textures = Texture.all.filter(t => t.group === tg!.uuid);
        texturePaths = textures.map(t => t.path).filter(Boolean);
        textures.forEach(t => t.remove(true));
        tg.remove();
    }

    for (let child of collection.getAllChildren()) {
        if (child instanceof Group) child.remove();
        else (child as OutlinerElement).remove();
    }
    collection.extend({ children: [] });

    unloadedStates.set(collection.uuid, { json, texturePaths, primaryTexturePath });
    let uc = collection as UnloadedCollection;
    uc.unloaded = true;
    uc.unloaded_texture_paths = JSON.stringify(texturePaths);
    uc.unloaded_primary_path = primaryTexturePath;
    unwatchCollection(collection);

    setUnloadedAttr(collection, true);
    Canvas.updateAllFaces();
    collection.saved = savedState;
    scheduleFolderUpdate();
}

export function reloadCollection(collection: Collection) {
    if (!isUnloaded(collection)) return;

    let savedState = collection.saved;
    let state = unloadedStates.get(collection.uuid);
    let path = collection.export_path;

    let fs = requireNativeModule('fs');
    let json: any;
    let useFile = path && fs.existsSync(path);

    if (useFile) {
        json = autoParseJSON(fs.readFileSync(path, 'utf-8'));
    } else if (state) {
        json = state.json;
    } else {
        return;
    }

    let result: any = Codecs.blockymodel.parse(json, path || '', { attachment: collection.name });
    let new_groups: Group[] = result.new_groups;
    let root_groups = new_groups.filter(g => !new_groups.includes(g.parent as Group));
    collection.extend({ children: root_groups.map(g => g.uuid) }).add();
    assignCollectionScope(collection);

    let uc = collection as UnloadedCollection;
    let texturePaths: string[] = state?.texturePaths ?? [];
    if (texturePaths.length === 0 && uc.unloaded_texture_paths) {
        try { texturePaths = JSON.parse(uc.unloaded_texture_paths); } catch {}
    }
    if (useFile) {
        let dirname = PathModule.dirname(path);
        for (let tp of discoverTexturePaths(dirname, collection.name)) {
            if (!texturePaths.includes(tp)) texturePaths.push(tp);
        }
    }
    let primaryTexturePath = state?.primaryTexturePath || uc.unloaded_primary_path || '';

    let tg = new TextureGroup({ name: collection.name });
    tg.folded = true;
    tg.add();

    let allTextures: Texture[] = [];
    for (let tp of texturePaths) {
        let existing = Texture.all.find(t => t.path === tp);
        if (existing) {
            existing.group = tg.uuid;
            allTextures.push(existing);
        } else if (fs.existsSync(tp)) {
            let tex = new Texture().fromPath(tp).add(false, true);
            tex.group = tg.uuid;
            allTextures.push(tex);
        }
    }

    if (primaryTexturePath) {
        let primary = allTextures.find(t => t.path === primaryTexturePath);
        if (primary) (collection as AttachmentCollection).texture = primary.uuid;
    } else if (allTextures.length > 0) {
        let primary = allTextures.find(t => t.name.startsWith(collection.name)) ?? allTextures[0];
        (collection as AttachmentCollection).texture = primary.uuid;
    }

    uc.unloaded = false;
    uc.unloaded_texture_paths = '';
    uc.unloaded_primary_path = '';
    unloadedStates.delete(collection.uuid);
    watchCollection(collection);

    setUnloadedAttr(collection, false);
    Canvas.updateAllFaces();
    collection.saved = savedState;
    scheduleFolderUpdate();
}

export async function promptAndUnload(collections: Collection[]): Promise<boolean> {
    let toUnload = collections.filter(c => !isUnloaded(c) && c.export_codec === 'blockymodel');
    if (toUnload.length === 0) return true;

    let unsaved = toUnload.filter(c => c.saved === false);
    if (unsaved.length > 0) {
        let message = unsaved.length === 1
            ? `"${unsaved[0].name}" has unsaved changes.`
            : `${unsaved.length} attachments have unsaved changes:\n${unsaved.map(c => `• ${c.name}`).join('\n')}`;

        let result = await new Promise<number>(resolve => {
            Blockbench.showMessageBox({
                title: 'Unsaved Attachment Changes',
                message,
                icon: 'warning',
                buttons: ['dialog.save', 'dialog.discard', 'dialog.cancel'],
                confirm: 0,
                cancel: 2,
            }, resolve);
        });

        if (result === 2) return false;
        if (result === 0) {
            for (let c of unsaved) {
                await Codecs.blockymodel.writeCollection(c);
            }
        }
    }

    for (let c of toUnload) unloadCollection(c);
    return true;
}

export async function toggleCollectionLoaded(collection: Collection) {
    if (isUnloaded(collection)) {
        reloadCollection(collection);
    } else {
        await promptAndUnload([collection]);
    }
}

export function toggleCollectionChildVisibility(collections: Collection[]) {
    let loaded = collections.filter(c => !isUnloaded(c));
    if (!loaded.length) return;
    let allHidden = loaded.every(c => !c.getVisibility());
    let allElements: OutlinerElement[] = [];
    for (let c of loaded) {
        for (let child of c.getAllChildren()) {
            if (!('visibility' in child) || typeof (child as any).visibility !== 'boolean') continue;
            (child as any).visibility = allHidden;
            if (!(child instanceof Group)) allElements.push(child as OutlinerElement);
        }
    }
    Canvas.updateView({ elements: allElements, element_aspects: { visibility: true } });
}

export function setupUnload() {
    let unloadedProp = new Property(Collection, 'boolean', 'unloaded', {
        default: false,
        condition: { formats: FORMAT_IDS }
    });
    let texPathsProp = new Property(Collection, 'string', 'unloaded_texture_paths', {
        default: '',
        condition: { formats: FORMAT_IDS }
    });
    let primaryPathProp = new Property(Collection, 'string', 'unloaded_primary_path', {
        default: '',
        condition: { formats: FORMAT_IDS }
    });
    track(unloadedProp, texPathsProp, primaryPathProp);

    let originalToggle = Collection.prototype.toggleVisibility;
    Collection.prototype.toggleVisibility = function(event: KeyboardEvent | MouseEvent) {
        if (!isHytaleFormat() || this.export_codec !== 'blockymodel') {
            return originalToggle.call(this, event);
        }
        if (isUnloaded(this)) {
            reloadCollection(this);
            return;
        }
        toggleCollectionChildVisibility([this]);
    };
    track({ delete() { Collection.prototype.toggleVisibility = originalToggle; } });

    // data-hytale-unloaded attribute survives Vue re-renders (unlike CSS classes)
    let style = Blockbench.addCSS(`
        #collections_list li.collection[${UNLOADED_ATTR}] {
            opacity: 0.45;
        }
        #collections_list li.collection[${UNLOADED_ATTR}] > .in_list_button:last-child {
            display: none;
        }
        #collections_list .hytale_unload_btn {
            cursor: pointer;
        }
    `);
    track(style);

    function syncUnloadButtons() {
        if (!isHytaleFormat()) return;
        let list = Panels.collections?.node?.querySelector('#collections_list');
        if (!list) return;
        for (let collection of Collection.all) {
            let el = list.querySelector(`[uuid="${collection.uuid}"]`) as HTMLElement;
            if (!el) continue;

            let unloaded = isUnloaded(collection);
            if (unloaded) el.setAttribute(UNLOADED_ATTR, '');
            else el.removeAttribute(UNLOADED_ATTR);

            if (collection.export_codec !== 'blockymodel') continue;

            // Hide the scope color border (scope is used for save-tracking only)
            el.style.setProperty('--color-scope', 'transparent', 'important');

            let existing = el.querySelector('.hytale_unload_btn');
            if (existing) {
                let icon = existing.querySelector('i')!;
                icon.textContent = unloaded ? 'download' : 'eject';
                icon.classList.toggle('toggle_disabled', unloaded);
                continue;
            }

            let visBtn = el.querySelector(':scope > .in_list_button:last-child') as HTMLElement;
            if (!visBtn) continue;

            let btn = document.createElement('div');
            btn.className = 'in_list_button hytale_unload_btn';
            let icon = document.createElement('i');
            icon.className = 'material-icons icon';
            icon.textContent = unloaded ? 'download' : 'eject';
            if (unloaded) icon.classList.add('toggle_disabled');
            btn.appendChild(icon);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCollectionLoaded(collection);
            });
            btn.addEventListener('dblclick', (e) => e.stopPropagation());
            visBtn.insertAdjacentElement('beforebegin', btn);
        }
    }

    function unloadAllOnOpen() {
        if (!isHytaleFormat()) return;
        for (let collection of Collection.all) {
            if (collection.export_codec === 'blockymodel' && !isUnloaded(collection)) {
                unloadCollection(collection);
            }
        }
        for (let folder of CollectionFolder.all) {
            if (!folder.folded) {
                folder.folded = true;
            }
        }
        scheduleFolderUpdate();
    }

    let hookOpen = Blockbench.on('load_project', unloadAllOnOpen);
    let hookEdit = Blockbench.on('finished_edit', syncUnloadButtons);
    let hookSelection = Blockbench.on('update_selection', syncUnloadButtons);
    let hookProject = Blockbench.on('select_project', syncUnloadButtons);
    setTimeout(syncUnloadButtons, 150);

    track(hookOpen, hookEdit, hookSelection, hookProject, {
        delete() {
            unloadedStates.clear();
            let list = Panels.collections?.node?.querySelector('#collections_list');
            if (list) {
                list.querySelectorAll(`[${UNLOADED_ATTR}]`).forEach(el => el.removeAttribute(UNLOADED_ATTR));
                list.querySelectorAll('.hytale_unload_btn').forEach(el => el.remove());
                list.querySelectorAll('li.collection').forEach(el => (el as HTMLElement).style.removeProperty('--color-scope'));
            }
        }
    });
}
