//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "../cleanup";
import { FORMAT_IDS, isHytaleFormat } from "../formats";
import { reloadAttachment } from "./import";

const POLL_INTERVAL = 1500;

// uuid -> last known mtime
const watchedCollections = new Map<string, number>();
const watchedProjects = new Map<string, number>();
// Self-writes: next poll silently updates mtime instead of prompting
const pendingRefresh = new Set<string>();
let setting: Setting;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function getMtime(path: string): number | null {
	let fs = requireNativeModule('fs');
	if (!fs.existsSync(path)) return null;
	let stat = fs.statSync(path);
	return stat.mtimeMs ?? new Date(stat.mtime).getTime();
}

function pollChanges() {
	for (let project of ModelProject.all) {
		// Poll attachment collections
		for (let collection of project.collections) {
			if (!collection.export_path || collection.export_codec !== 'blockymodel') continue;
			let lastMtime = watchedCollections.get(collection.uuid);
			if (lastMtime === undefined) continue;

			let mtime = getMtime(collection.export_path);
			if (mtime === null || mtime <= lastMtime) continue;

			watchedCollections.set(collection.uuid, mtime);
			let key = collection.export_path + ':' + project.uuid;
			if (pendingRefresh.delete(key)) continue;
			promptCollectionReload(collection);
		}

		// Poll main project file
		if (!project.export_path || !FORMAT_IDS.includes(project.format?.id)) continue;
		let lastMtime = watchedProjects.get(project.uuid);
		if (lastMtime === undefined) continue;

		let mtime = getMtime(project.export_path);
		if (mtime === null || mtime <= lastMtime) continue;

		watchedProjects.set(project.uuid, mtime);
		let key = project.export_path + ':' + project.uuid;
		if (pendingRefresh.delete(key)) continue;
		promptProjectReload(project);
	}
}

function startPolling() {
	if (pollTimer) return;
	pollTimer = setInterval(pollChanges, POLL_INTERVAL);
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

function promptCollectionReload(collection: Collection) {
	let project = ModelProject.all.find(p => p.collections.includes(collection));
	if (project && Project !== project) {
		project.whenNextOpen(() => promptCollectionReload(collection));
		return;
	}

	Blockbench.showMessageBox({
		title: 'Attachment Changed',
		message: `"${collection.name}" was modified on disk. Reload it?`,
		buttons: ['Reload', 'Ignore'],
	}, (choice: number) => {
		if (choice === 0) {
			reloadAttachment(collection);
		}
	});
}

function promptProjectReload(project: ModelProject) {
	if (Project !== project) {
		project.whenNextOpen(() => promptProjectReload(project));
		return;
	}

	Blockbench.showMessageBox({
		title: 'Model Changed',
		message: `"${project.getDisplayName()}" was modified on disk. Reload it?`,
		buttons: ['Reload', 'Ignore'],
	}, (choice: number) => {
		if (choice === 0) {
			reloadProject(project);
		}
	});
}

function reloadProject(project: ModelProject) {
	let path = project.export_path;
	if (!path) return;

	let fs = requireNativeModule('fs');
	if (!fs.existsSync(path)) return;

	project.select();

	// Clear existing geometry and textures
	for (let node of [...Outliner.root]) {
		if (node instanceof OutlinerNode) node.remove();
	}
	for (let tex of [...Texture.all]) tex.remove();
	for (let tg of [...TextureGroup.all]) tg.remove();
	for (let col of [...Collection.all]) Collection.all.remove(col);

	// Re-parse in place
	let content = fs.readFileSync(path, 'utf-8');
	let json = autoParseJSON(content);
	Codecs.blockymodel.parse(json, path);

	Canvas.updateAll();
}

// Mark a path as self-written for the current project.
// Next poll silently absorbs the mtime change instead of prompting.
export function markSelfWrite(path: string) {
	if (!Project) return;
	pendingRefresh.add(path + ':' + Project.uuid);
}

function syncWatchers() {
	if (!setting?.value) {
		watchedCollections.clear();
		watchedProjects.clear();
		stopPolling();
		return;
	}

	let activeCollectionUuids = new Set<string>();
	let activeProjectUuids = new Set<string>();

	for (let project of ModelProject.all) {
		// Track collections
		for (let collection of project.collections) {
			if (collection.export_path && collection.export_codec === 'blockymodel') {
				activeCollectionUuids.add(collection.uuid);
				if (!watchedCollections.has(collection.uuid)) {
					let mtime = getMtime(collection.export_path);
					if (mtime !== null) watchedCollections.set(collection.uuid, mtime);
				}
			}
		}
		// Track main project file
		if (project.export_path && FORMAT_IDS.includes(project.format?.id)) {
			activeProjectUuids.add(project.uuid);
			if (!watchedProjects.has(project.uuid)) {
				let mtime = getMtime(project.export_path);
				if (mtime !== null) watchedProjects.set(project.uuid, mtime);
			}
		}
	}

	for (let [uuid] of watchedCollections) {
		if (!activeCollectionUuids.has(uuid)) watchedCollections.delete(uuid);
	}
	for (let [uuid] of watchedProjects) {
		if (!activeProjectUuids.has(uuid)) watchedProjects.delete(uuid);
	}

	if (watchedCollections.size > 0 || watchedProjects.size > 0) {
		startPolling();
	} else {
		stopPolling();
	}
}

export function watchCollection(collection: Collection) {
	if (!setting?.value) return;
	let mtime = getMtime(collection.export_path);
	if (mtime !== null) watchedCollections.set(collection.uuid, mtime);
	startPolling();
}

export function unwatchCollection(collection: Collection) {
	watchedCollections.delete(collection.uuid);
	if (watchedCollections.size === 0 && watchedProjects.size === 0) stopPolling();
}

export function setupAttachmentWatcher() {
	setting = new Setting('watch_attachment_files', {
		name: 'Watch Attachment Files',
		category: 'edit',
		description: 'Watch attachment files on disk for external changes and prompt to reload when modified.',
		type: 'toggle',
		value: false,
		onChange(value: boolean) {
			if (value) {
				syncWatchers();
			} else {
				watchedCollections.clear();
				watchedProjects.clear();
				stopPolling();
			}
		}
	});
	track(setting);

	let onSelectProject = Blockbench.on('select_project', syncWatchers);
	track(onSelectProject);

	let onFinishedEdit = Blockbench.on('finished_edit', syncWatchers);
	track(onFinishedEdit);

	track({
		delete() {
			watchedCollections.clear();
			watchedProjects.clear();
			stopPolling();
		}
	});
}
