//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { copyAnimationToGroupsWithSameName } from "./name_overlap";
import { track } from "./cleanup";
import { Config } from "./config";
import { FORMAT_IDS } from "./formats";

const FPS = 60;
// @ts-expect-error
const Animation = window.Animation as typeof _Animation;

type IBlockyAnimJSON = {
	formatVersion: 1
	duration: number
	holdLastKeyframe: boolean
	nodeAnimations: Record<string, IAnimationObject>
}
interface IAnimationObject {
	position?: IKeyframe[]
	orientation?: IKeyframe[]
	shapeStretch?: IKeyframe[]
	shapeVisible?: IKeyframe[]
	shapeUvOffset?: IKeyframe[]
}
interface IKeyframe {
	time: number
	delta: {x: number, y: number, z: number, w?: number} | boolean
	interpolationType?: 'smooth' | 'linear'
}

export function parseAnimationFile(file: Filesystem.FileResult, content: IBlockyAnimJSON) {
	let animation = new Animation({
		name: pathToName(file.name, false),
		length: content.duration / FPS,
		loop: content.holdLastKeyframe ? 'hold' : 'loop',
		path: file.path,
		snapping: FPS,
	});
	let quaternion = new THREE.Quaternion();
	let euler = new THREE.Euler(0, 0, 0, 'ZYX');

	for (let name in content.nodeAnimations) {
		let anim_data = content.nodeAnimations[name];
		let group_name = name;//.replace(/-/g, '_');
		let group = Group.all.find(g => g.name == group_name);
		let uuid = group ? group.uuid : guid();

		let ba = new BoneAnimator(uuid, animation, group_name);
		animation.animators[uuid] = ba;

		//Channels
		const anim_channels = [
			{ channel: 'rotation', keyframes: anim_data.orientation },
			{ channel: 'position', keyframes: anim_data.position },
			{ channel: 'scale', keyframes: anim_data.shapeStretch },
			{ channel: 'visibility', keyframes: anim_data.shapeVisible },
			{ channel: 'uv_offset', keyframes: anim_data.shapeUvOffset },
		]
		for (let {channel, keyframes} of anim_channels) {
			if (!keyframes || keyframes.length == 0) continue;

			for (let kf_data of keyframes) {
				let data_point;
				if (channel == 'visibility') {
					data_point = {
						visibility: kf_data.delta as boolean
					}
				} else if (channel == 'uv_offset') {
					let delta = kf_data.delta as {x: number, y: number};
					data_point = {
						x: delta.x,
						y: -delta.y,
					}
				} else {
					let delta = kf_data.delta as {x: number, y: number, z: number, w?: number};
					if (channel == 'rotation') {
						quaternion.set(delta.x, delta.y, delta.z, delta.w);
						euler.setFromQuaternion(quaternion.normalize(), 'ZYX');
						data_point = {
							x: Math.radToDeg(euler.x),
							y: Math.radToDeg(euler.y),
							z: Math.radToDeg(euler.z),
						}
					} else {
						data_point = {
							x: delta.x,
							y: delta.y,
							z: delta.z,
						}
					}
				}
				ba.addKeyframe({
					time: kf_data.time / FPS,
					channel,
					interpolation: kf_data.interpolationType == 'smooth' ? 'catmullrom' : 'linear',
					data_points: [data_point]
				});
			}
		}

		// Copy to others with same name
		if (group) copyAnimationToGroupsWithSameName(animation, group);
	}
	animation.add(false);

	if (!Animation.selected && Animator.open) {
		animation.select()
	}

}
function compileAnimationFile(animation: _Animation): IBlockyAnimJSON {
	const nodeAnimations: Record<string, IAnimationObject> = {};
	const file: IBlockyAnimJSON = {
		formatVersion: 1,
		duration: animation.length * FPS,
		holdLastKeyframe: animation.loop == 'hold',
		nodeAnimations,
	}
	const channels = {
		position: 'position',
		rotation: 'orientation',
		scale: 'shapeStretch',
		visibility: 'shapeVisible',
		uv_offset: 'shapeUvOffset',
	}
	for (let uuid in animation.animators) {
		let animator = animation.animators[uuid];
		if (!animator.group) continue;
		let name = animator.name;
		let node_data: IAnimationObject = {};
		let has_data = false;

		for (let channel in channels) {
			let timeline: IKeyframe[];
			let hytale_channel_key = channels[channel];
			timeline = timeline = node_data[hytale_channel_key] = [];
			let keyframe_list = (animator[channel].slice() as _Keyframe[]);
			keyframe_list.sort((a, b) => a.time - b.time);
			for (let kf of keyframe_list) {
				let data_point = kf.data_points[0];
				let delta: any;
				if (channel == 'visibility') {
					delta = data_point.visibility;
				} else if (channel == 'uv_offset') {
					delta = {
						x: parseFloat(data_point.x),
						y: -parseFloat(data_point.y),
					};
					delta = new oneLiner(delta);
				} else {
					delta = {
						x: parseFloat(data_point.x),
						y: parseFloat(data_point.y),
						z: parseFloat(data_point.z),
					};
					if (channel == 'rotation') {
						let euler = new THREE.Euler(
							Math.degToRad(kf.calc('x')),
							Math.degToRad(kf.calc('y')),
							Math.degToRad(kf.calc('z')),
							Format.euler_order,
						);
						let quaternion = new THREE.Quaternion().setFromEuler(euler);

						delta = {
							x: quaternion.x,
							y: quaternion.y,
							z: quaternion.z,
							w: quaternion.w,
						};
					}
					delta = new oneLiner(delta);
				}
				let kf_output: IKeyframe = {
					time: Math.round(kf.time * FPS),
					delta,
					interpolationType: kf.interpolation == 'catmullrom' ? 'smooth' : 'linear'
				};
				if (channel == 'uv_offset') console.log(kf_output)
				timeline.push(kf_output);
				has_data = true;
			}
		}
		if (has_data) {
			if (!node_data.shapeUvOffset) {
				node_data.shapeUvOffset = [];
			}
			nodeAnimations[name] = node_data;
		}
	}
	return file;
}

export function setupAnimationCodec() {
	// @ts-expect-error
	BarItems.load_animation_file.click = function (...args) {
		if (FORMAT_IDS.includes(Format.id)) {
			Filesystem.importFile({
				resource_id: 'blockyanim',
				extensions: ['blockyanim'],
				type: 'Blockyanim',
				multiple: true,
			}, async function(files) {
				for (let file of files) {
					let content = autoParseJSON(file.content as string);
					parseAnimationFile(file, content);
				}
			})
			return;
		} else {
			this.dispatchEvent('use');
			this.onClick(...args);
			this.dispatchEvent('used');
		}
	}

	let export_anim = new Action('export_blockyanim', {
		name: 'Export Blockyanim',
		icon: 'cinematic_blur',
		condition: {formats: FORMAT_IDS, selected: {animation: true}},
		click() {
			let animation: _Animation;
			// @ts-ignore
			animation = Animation.selected;
			let content = compileJSON(compileAnimationFile(animation), Config.json_compile_options);
			Filesystem.exportFile({
				resource_id: 'blockyanim',
				type: 'Blockyanim',
				extensions: ['blockyanim'],
				name: animation.name,
				content
			})
		}
	})
	track(export_anim);
	MenuBar.menus.animation.addAction(export_anim);
	Panels.animations.toolbars[0].add(export_anim, '4');

	let handler = Filesystem.addDragHandler('blockyanim', {
		extensions: ['blockyanim'],
		readtype: 'text',
		condition: {modes: ['animate']},
	}, async function(files) {
		for (let file of files) {
			let content = autoParseJSON(file.content as string);
			parseAnimationFile(file, content);
		}
	});
	track(handler);

	// save
	let original_save = Animation.prototype.save;
	Animation.prototype.save = function(...args) {
		if (!FORMAT_IDS.includes(Format.id)) {
			return original_save.call(this, ...args);
		}

		let animation: _Animation;
		// @ts-ignore
		animation = Animation.selected;
		let content = compileJSON(compileAnimationFile(animation), Config.json_compile_options);

		if (isApp && this.path) {
			// Write
			Blockbench.writeFile(this.path, {content}, (real_path) => {
				this.saved = true;
				this.saved_name = this.name;
				this.path = real_path;
			});
		} else {
			Blockbench.export({
				resource_id: 'blockyanim',
				type: 'Blockyanim',
				extensions: ['blockyanim'],
				name: animation.name,
				startpath: this.path,
				content,
			}, (real_path: string) => {
				if (isApp) this.path == real_path;
				this.saved = true;
			})
		}
		return this;
	}
	track({
		delete() {
			Animation.prototype.save = original_save;
		}
	});

	let original_condition = BarItems.export_animation_file.condition;
	BarItems.export_animation_file.condition = () => {
		return Condition(original_condition) && !FORMAT_IDS.includes(Format.id)
	};
	track({
		delete() {
			BarItems.export_animation_file.condition = original_condition;
		}
	});
}
