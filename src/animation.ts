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
	delta: {x: number, y: number, z: number}
	interpolationType: 'smooth' | 'linear'
}

function parseAnimationFile(file: Filesystem.FileResult, content: IBlockyAnimJSON) {
	let animation = new Animation({
		name: pathToName(file.name, false),
		length: content.duration / FPS,
		loop: content.holdLastKeyframe ? 'hold' : 'loop',
		path: file.path,
		snapping: FPS,
	});

	for (let name in content.nodeAnimations) {
		let group = Group.all.find(g => g.name == name);
		let anim_data = content.nodeAnimations[name];
		let uuid = group ? group.uuid : guid();

		let ba = new BoneAnimator(uuid, animation, name);
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
				ba.addKeyframe({
					time: kf_data.time / FPS,
					channel,
					interpolation: kf_data.interpolationType == 'smooth' ? 'catmullrom' : 'linear',
					data_points: [
						{
							x: kf_data.delta.x,
							y: kf_data.delta.y,
							z: kf_data.delta.z,
						}
					]
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
		duration: animation.length / FPS,
		holdLastKeyframe: animation.loop == 'hold',
		nodeAnimations,
	}
	for (let uuid in animation.animators) {
		let animator = animation.animators[uuid];
		let name = animator.name;
		nodeAnimations[name] = {};

		for (let channel in animator.channels) {
			let timeline: IKeyframe[];
			switch (channel) {
				case 'position': timeline = nodeAnimations[name].position = []; break;
				case 'rotation': timeline = nodeAnimations[name].orientation = []; break;
				case 'scale': timeline = nodeAnimations[name].shapeStretch = []; break;
			}
			for (let kf of animator[channel] as _Keyframe[]) {
				let kf_output: IKeyframe = {
					time: Math.round(kf.time * FPS),
					delta: {
						x: kf.data_points[0].x,
						y: kf.data_points[0].y,
						z: kf.data_points[0].z,
					},
					interpolationType: kf.interpolation == 'catmullrom' ? 'smooth' : 'linear'
				};
				timeline.push(kf_output);
			}
		}
	}
	return file;
}

export function setupAnimationActions(): Action[] {
	let import_anim = new Action('import_blockyanim', {
		name: 'Import Blockyanim',
		condition: {formats: ['hytale_model']},
		click() {
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
		}
	})
	let export_anim = new Action('export_blockyanim', {
		name: 'Export Blockyanim',
		condition: {formats: ['hytale_model']},
		click() {
			let animation: _Animation;
			// @ts-ignore
			animation = Animation.selected;
			let content = compileJSON(compileAnimationFile(animation));
			Filesystem.exportFile({
				resource_id: 'blockyanim',
				type: 'Blockyanim',
				extensions: ['blockyanim'],
				name: animation.name,
				content
			})
		}
	})
	return [import_anim, export_anim];
}