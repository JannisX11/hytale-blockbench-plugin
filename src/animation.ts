import { track } from "./cleanup";
import { Config } from "./config";

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
	delta: {x: number, y: number, z: number, w?: number}
	interpolationType: 'smooth' | 'linear'
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
		]
		for (let {channel, keyframes} of anim_channels) {
			if (!keyframes || keyframes.length == 0) continue;

			for (let kf_data of keyframes) {
				let data_point;
				if (channel == 'rotation') {
					quaternion.set(kf_data.delta.x, kf_data.delta.y, kf_data.delta.z, kf_data.delta.w);
					euler.setFromQuaternion(quaternion.normalize(), 'ZYX');
					data_point = {
						x: Math.radToDeg(euler.x),
						y: Math.radToDeg(euler.y),
						z: Math.radToDeg(euler.z),
					}
				} else {
					data_point = {
						x: kf_data.delta.x,
						y: kf_data.delta.y,
						z: kf_data.delta.z,
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
	}
	animation.add(true);

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
	}
	for (let uuid in animation.animators) {
		let animator = animation.animators[uuid];
		if (!animator.group) continue;
		let name = animator.name;
		let node_data = {};
		let has_data = false;

		for (let channel in channels) {
			let timeline: IKeyframe[];
			let hytale_channel_key = channels[channel];
			timeline = timeline = node_data[hytale_channel_key] = [];
			for (let kf of animator[channel] as _Keyframe[]) {
				let data_point = kf.data_points[0];
				let delta: any = {
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
				let kf_output: IKeyframe = {
					time: Math.round(kf.time * FPS),
					delta: new oneLiner(delta),
					interpolationType: kf.interpolation == 'catmullrom' ? 'smooth' : 'linear'
				};
				timeline.push(kf_output);
				has_data = true;
			}
		}
		if (has_data) {
			nodeAnimations[name] = node_data;
		}
	}
	return file;
}

export function setupAnimationActions() {
	// @ts-expect-error
	BarItems.load_animation_file.click = function (...args) {
		if (Format.id == Config.format_id) {
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
		condition: {formats: ['hytale_model'], selected: {animation: true}},
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
}