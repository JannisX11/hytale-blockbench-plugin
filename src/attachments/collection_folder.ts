//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { isUnloaded, reloadCollection, promptAndUnload } from "./unload";
import { importAttachmentToFolder } from "./import";
import { unwatchCollection } from "./watcher";

type FolderCollection = Collection & { folder: string };
type FolderProject = ModelProject & { collection_folders: CollectionFolderData[] };

interface CollectionFolderData {
    uuid?: string;
    name?: string;
    folded?: boolean;
    order?: number;
}

const GROUP_CLASS = 'hytale_collection_folder';
const HEAD_CLASS = 'hytale_collection_folder_head';
const LIST_CLASS = 'hytale_collection_folder_list';
const MEMBER_ATTR = 'data-hytale-folder';
let folders: CollectionFolder[] = [];
let updatePending = false;
let observer: MutationObserver | null = null;

function fc(c: Collection) { return c as FolderCollection; }
function fp() { return Project as FolderProject; }

function uniqueFolderName(base: string): string {
    let names = new Set(folders.map(f => f.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) {
        let name = `${base} ${i}`;
        if (!names.has(name)) return name;
    }
}

function syncToProject() {
    if (!Project) return;
    fp().collection_folders = folders.map(f => f.getSaveCopy());
}

function loadFromProject() {
    folders.length = 0;
    if (!Project) return;
    let data = fp().collection_folders;
    if (!Array.isArray(data)) return;
    for (let entry of data) folders.push(new CollectionFolder(entry));
    folders.sort((a, b) => a.order - b.order);
}

function setFolder(collections: Collection[], folderUuid: string, undoLabel: string) {
    Undo.initEdit({ collections });
    for (let c of collections) fc(c).folder = folderUuid;
    Undo.finishEdit(undoLabel);
    scheduleUpdate();
}

function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(() => {
        updatePending = false;
        injectFolderDOM();
    });
}

export { scheduleUpdate as scheduleFolderUpdate };

export class CollectionFolder {
    uuid: string;
    name: string;
    folded: boolean;
    order: number;
    menu: Menu;

    constructor(data?: CollectionFolderData) {
        this.uuid = data?.uuid ?? guid();
        this.name = data?.name ?? uniqueFolderName('Set');
        this.folded = data?.folded ?? false;
        this.order = data?.order ?? folders.length;
        this.menu = new Menu('collection_folder', [
            { id: 'rename', name: 'generic.rename', icon: 'text_format', click: () => this.rename() },
            { id: 'resolve', name: 'menu.texture_group.resolve', icon: 'fa-leaf', click: () => this.remove() },
            { id: 'delete_all', name: 'Delete Set and Attachments', icon: 'delete_forever', click: () => this.removeWithAttachments() },
        ]);
    }

    add() {
        if (!folders.includes(this)) folders.push(this);
        syncToProject();
        scheduleUpdate();
        return this;
    }

    remove() {
        setFolder(this.getCollections(), '', 'Remove collection folder');
        folders.remove(this);
        syncToProject();
    }

    removeWithAttachments() {
        let collections = this.getCollections();
        let remove_elements: OutlinerElement[] = [];
        let remove_groups: Group[] = [];
        let textures: Texture[] = [];
        let texture_groups: TextureGroup[] = [];

        for (let c of collections) {
            for (let child of c.getAllChildren()) {
                (child instanceof Group ? remove_groups : remove_elements).safePush(child as any);
            }
            let tg = TextureGroup.all.find(t => t.name === c.name);
            if (tg) {
                textures.safePush(...Texture.all.filter(t => t.group === tg!.uuid));
                texture_groups.push(tg);
            }
        }

        Undo.initEdit({
            collections,
            groups: remove_groups,
            elements: remove_elements,
            outliner: true,
            texture_groups: texture_groups as any,
            textures,
        });

        collections.forEach(c => {
            unwatchCollection(c);
            Collection.all.remove(c);
        });
        textures.forEach(t => t.remove(true));
        texture_groups.forEach(t => t.remove());
        remove_groups.forEach(g => g.remove());
        remove_elements.forEach(e => e.remove());

        updateSelection();
        Undo.finishEdit('Delete set and attachments');

        folders.remove(this);
        syncToProject();
        scheduleUpdate();
    }

    rename() {
        Blockbench.textPrompt('generic.rename', this.name, (name) => {
            if (name && name !== this.name) {
                this.name = name;
                syncToProject();
                scheduleUpdate();
            }
        });
    }

    toggle() {
        this.folded = !this.folded;
        syncToProject();
        scheduleUpdate();
    }

    getCollections(): FolderCollection[] {
        return (Collection.all as FolderCollection[]).filter(c => c.folder === this.uuid);
    }

    getSaveCopy(): CollectionFolderData {
        return { uuid: this.uuid, name: this.name, folded: this.folded, order: this.order };
    }

    showContextMenu(event: MouseEvent) { this.menu.open(event, this); }
    static get all() { return folders; }
}

function getUngroupedCollections(): Collection[] {
    return Collection.all.filter(c => {
        let f = fc(c).folder;
        return !f || !folders.find(folder => folder.uuid === f);
    });
}

function injectFolderDOM() {
    if (!isHytaleFormat()) return;
    let list = Panels.collections?.node?.querySelector('#collections_list') as HTMLElement;
    if (!list) return;

    observer?.disconnect();

    // Unwrap any previously grouped collections back into the main list
    list.querySelectorAll(`.${GROUP_CLASS}`).forEach(group => {
        let children = group.querySelectorAll(':scope > .'+LIST_CLASS+' > li.collection');
        children.forEach(el => {
            (el as HTMLElement).style.removeProperty('display');
            el.removeAttribute(MEMBER_ATTR);
            list.insertBefore(el, group);
        });
        group.remove();
    });

    let collectionEls = Array.from(list.querySelectorAll(':scope > li.collection')) as HTMLElement[];

    function findEl(uuid: string) {
        return collectionEls.find(el => el.getAttribute('uuid') === uuid) ?? null;
    }

    let sorted = folders.slice().sort((a, b) => a.order - b.order);

    for (let i = sorted.length - 1; i >= 0; i--) {
        let group = createFolderGroup(sorted[i], collectionEls);
        list.prepend(group);
    }

    for (let c of getUngroupedCollections()) {
        let el = findEl(c.uuid);
        if (el) list.appendChild(el);
    }

    observer?.observe(list, { childList: true });
}

function createFolderGroup(folder: CollectionFolder, collectionEls: HTMLElement[]): HTMLElement {
    let group = document.createElement('li');
    group.className = GROUP_CLASS;

    // Head (matches .texture_group_head)
    let head = document.createElement('div');
    head.className = HEAD_CLASS;
    head.setAttribute('data-folder-uuid', folder.uuid);
    if (folder.folded) head.classList.add('folded');

    let arrow = document.createElement('i');
    arrow.className = 'icon-open-state fa ' + (folder.folded ? 'fa-angle-right' : 'fa-angle-down');
    head.appendChild(arrow);

    let label = document.createElement('label');
    label.textContent = folder.name;
    label.title = folder.name;
    head.appendChild(label);

    if (!folder.folded) {
        let addBtn = document.createElement('div');
        addBtn.className = 'in_list_button';
        let addIcon = document.createElement('i');
        addIcon.className = 'material-icons icon';
        addIcon.textContent = 'add';
        addBtn.appendChild(addIcon);
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            importAttachmentToFolder(folder.uuid);
        });
        addBtn.addEventListener('dblclick', (e) => e.stopPropagation());
        head.appendChild(addBtn);
    }

    let collections = folder.getCollections();
    let allUnloaded = collections.length > 0 && collections.every(c => isUnloaded(c));
    let visBtn = document.createElement('div');
    visBtn.className = 'in_list_button';
    let visIcon = document.createElement('i');
    visIcon.className = 'material-icons icon';
    if (allUnloaded) visIcon.classList.add('toggle_disabled');
    visIcon.textContent = allUnloaded ? 'visibility_off' : 'visibility';
    visBtn.appendChild(visIcon);
    visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allUnloaded) {
            for (let c of collections) {
                if (isUnloaded(c)) reloadCollection(c);
            }
        } else {
            promptAndUnload(collections);
        }
    });
    visBtn.addEventListener('dblclick', (e) => e.stopPropagation());
    head.appendChild(visBtn);

    head.addEventListener('click', (e) => { e.stopPropagation(); folder.toggle(); });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); folder.showContextMenu(e); });
    head.addEventListener('dragover', (e) => { e.preventDefault(); head.classList.add('drag_hover'); });
    head.addEventListener('dragleave', () => head.classList.remove('drag_hover'));
    head.addEventListener('drop', (e) => {
        e.preventDefault();
        head.classList.remove('drag_hover');
        let uuid = e.dataTransfer?.getData('text/collection-uuid');
        let collection = uuid ? Collection.all.find(c => c.uuid === uuid) : null;
        if (!collection) return;
        let collections = Collection.selected.includes(collection) && Collection.selected.length > 1
            ? Collection.selected : [collection];
        setFolder(collections, folder.uuid, 'Move collection to folder');
    });

    group.appendChild(head);

    let childList = document.createElement('ul');
    childList.className = LIST_CLASS;
    if (folder.folded) childList.style.display = 'none';

    for (let collection of folder.getCollections()) {
        let el = collectionEls.find(cel => cel.getAttribute('uuid') === collection.uuid);
        if (!el) continue;
        el.setAttribute(MEMBER_ATTR, folder.uuid);
        childList.appendChild(el);
    }

    group.appendChild(childList);

    return group;
}

function setupCollectionDrag() {
    let panel = Panels.collections?.node;
    if (!panel) return;

    panel.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!isHytaleFormat()) return;
        let target = e.target as HTMLElement;
        while (target && !target.classList?.contains('collection')) {
            if (target === panel) return;
            target = target.parentElement as HTMLElement;
        }
        if (!target) return;

        let uuid = target.getAttribute('uuid');
        if (!uuid) return;

        let dragCollection = Collection.all.find(c => c.uuid === uuid);
        if (!dragCollection) return;
        let dragCollections = Collection.selected.includes(dragCollection) && Collection.selected.length > 1
            ? Collection.selected.slice() : [dragCollection];

        let startX = e.clientX, startY = e.clientY;
        let active = false;
        let helper: HTMLElement | null = null;

        function onMove(e2: MouseEvent) {
            let dx = e2.clientX - startX, dy = e2.clientY - startY;
            if (!active && Math.sqrt(dx * dx + dy * dy) > 6) {
                active = true;
                helper = document.createElement('div');
                helper.className = 'hytale_collection_drag_helper';
                helper.textContent = dragCollections.length > 1
                    ? `${dragCollections.length} attachments`
                    : dragCollections[0].name;
                document.body.appendChild(helper);
            }
            if (!active || !helper) return;
            e2.preventDefault();
            helper.style.left = `${e2.clientX}px`;
            helper.style.top = `${e2.clientY}px`;

            document.querySelectorAll(`.${HEAD_CLASS}`).forEach(el => el.classList.remove('drag_hover'));
            let under = document.elementFromPoint(e2.clientX, e2.clientY)?.closest(`.${HEAD_CLASS}`) as HTMLElement | null;
            if (under) under.classList.add('drag_hover');
        }

        function onUp(e2: MouseEvent) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            helper?.remove();
            document.querySelectorAll(`.${HEAD_CLASS}`).forEach(el => el.classList.remove('drag_hover'));
            if (!active) return;

            let folderHead = document.elementFromPoint(e2.clientX, e2.clientY)?.closest(`.${HEAD_CLASS}`) as HTMLElement | null;
            let targetUuid = folderHead?.getAttribute('data-folder-uuid') ?? '';
            let toMove = dragCollections.filter(c => fc(c).folder !== targetUuid);
            if (toMove.length > 0) {
                setFolder(toMove, targetUuid, 'Move collection to folder');
            }
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

export function setupCollectionFolders() {
    let folderProp = new Property(Collection, 'string', 'folder', { default: '', condition: { formats: FORMAT_IDS } });
    let foldersProp = new Property(ModelProject, 'array', 'collection_folders', { default: [], condition: { formats: FORMAT_IDS } });
    track(folderProp, foldersProp);

    let createAction = new Action('create_collection_folder', {
        name: 'Create Set', icon: 'create_new_folder', category: 'collections',
        condition: { formats: FORMAT_IDS },
        click() {
            new CollectionFolder().add();
        }
    });
    track(createAction);
    Panels.collections.toolbars[0].add(createAction);
    Panels.collections.menu.addAction(createAction);

    let moveMenu: CustomMenuItem = {
        id: 'move_to_folder', name: 'Move to Set', icon: 'drive_file_move',
        condition: { formats: FORMAT_IDS },
        children() {
            let items: CustomMenuItem[] = [{
                icon: 'block', name: 'generic.none',
                click(ctx: Collection) { setFolder([ctx], '', 'Remove collection from folder'); }
            }];
            for (let folder of folders) {
                items.push({
                    icon: 'folder', name: folder.name,
                    click(ctx: Collection) { setFolder([ctx], folder.uuid, 'Move collection to folder'); }
                });
            }
            return items;
        }
    };
    Collection.menu.addAction(moveMenu, '#settings');
    track({ delete() { Collection.menu.removeAction('move_to_folder'); } });

    let reloadAndUpdate = () => { loadFromProject(); scheduleUpdate(); };
    let hookProject = Blockbench.on('select_project', reloadAndUpdate);
    let hookEdit = Blockbench.on('finished_edit', scheduleUpdate);
    let hookSelection = Blockbench.on('update_selection', scheduleUpdate);
    let hookMode = Blockbench.on('select_mode', scheduleUpdate);
    let hookUndo = Blockbench.on('undo', reloadAndUpdate);
    let hookRedo = Blockbench.on('redo', reloadAndUpdate);

    let listEl = Panels.collections?.node?.querySelector('#collections_list');
    if (listEl) {
        observer = new MutationObserver(scheduleUpdate);
        observer.observe(listEl, { childList: true });
    }

    setupCollectionDrag();

    let style = Blockbench.addCSS(`
        .${GROUP_CLASS} {
            padding-bottom: 4px;
        }
        .${HEAD_CLASS} {
            height: 32px;
            padding: 4px;
            padding-right: 8px;
            display: flex;
            gap: 5px;
            align-items: center;
            cursor: pointer;
        }
        .${HEAD_CLASS}:hover {
            color: var(--color-text);
        }
        .${HEAD_CLASS}.drag_hover {
            background: var(--color-accent);
            color: var(--color-accent_text);
        }
        .${HEAD_CLASS} > .icon-open-state {
            text-align: center;
            width: 21px;
            margin-top: 4px;
            flex-shrink: 0;
        }
        .${HEAD_CLASS} > label {
            flex: 1;
            overflow: hidden;
            white-space: nowrap;
            cursor: pointer;
        }
        .${HEAD_CLASS} > .in_list_button {
            margin-left: auto;
        }
        .${HEAD_CLASS}.folded > label {
            max-width: calc(60% - 50px);
            min-width: 30px;
        }
        .${LIST_CLASS} {
            margin-left: 14px;
            padding-left: 6px;
            border-left: 2px solid var(--color-guidelines);
        }
        .hytale_collection_drag_helper {
            position: fixed; pointer-events: none; z-index: 1000;
            background: var(--color-accent); color: var(--color-accent_text);
            padding: 2px 8px; border-radius: 4px; font-size: 12px;
            transform: translate(10px, -50%);
        }
    `);

    loadFromProject();
    setTimeout(scheduleUpdate, 100);

    track(hookProject, hookEdit, hookSelection, hookMode, hookUndo, hookRedo, style, {
        delete() {
            observer?.disconnect();
            folders.length = 0;
            let list = Panels.collections?.node?.querySelector('#collections_list');
            if (list) {
                list.querySelectorAll(`.${GROUP_CLASS}`).forEach(group => {
                    let children = group.querySelectorAll('li.collection');
                    children.forEach(el => {
                        el.removeAttribute(MEMBER_ATTR);
                        list!.insertBefore(el, group);
                    });
                    group.remove();
                });
            }
        }
    });
}
