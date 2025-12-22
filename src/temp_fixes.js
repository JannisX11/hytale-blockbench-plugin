export function setupTempFixes() {
    if (!Blockbench.isOlderThan('5.0.7')) return;

    Cube.prototype.mapAutoUV = function(options = {}) {
        if (this.box_uv) return;
        var scope = this;
        if (scope.autouv === 2) {
            //Relative UV
            var all_faces = ['north', 'south', 'west', 'east', 'up', 'down']
            let offset = Format.centered_grid ? 8 : 0;
            all_faces.forEach(function(side) {
                var uv = scope.faces[side].uv.slice()
                let texture = scope.faces[side].getTexture();
                let uv_width = Project.getUVWidth(texture);
                let uv_height = Project.getUVHeight(texture);

                switch (side) {
                    case 'north':
                    uv = [
                        uv_width - (scope.to[0]+offset),
                        uv_height - scope.to[1],
                        uv_width - (scope.from[0]+offset),
                        uv_height - scope.from[1],
                    ];
                    break;
                    case 'south':
                    uv = [
                        (scope.from[0]+offset),
                        uv_height - scope.to[1],
                        (scope.to[0]+offset),
                        uv_height - scope.from[1],
                    ];
                    break;
                    case 'west':
                    uv = [
                        (scope.from[2]+offset),
                        uv_height - scope.to[1],
                        (scope.to[2]+offset),
                        uv_height - scope.from[1],
                    ];
                    break;
                    case 'east':
                    uv = [
                        uv_width - (scope.to[2]+offset),
                        uv_height - scope.to[1],
                        uv_width - (scope.from[2]+offset),
                        uv_height - scope.from[1],
                    ];
                    break;
                    case 'up':
                    uv = [
                        (scope.from[0]+offset),
                        (scope.from[2]+offset),
                        (scope.to[0]+offset),
                        (scope.to[2]+offset),
                    ];
                    break;
                    case 'down':
                    uv = [
                        (scope.from[0]+offset),
                        uv_height - (scope.to[2]+offset),
                        (scope.to[0]+offset),
                        uv_height - (scope.from[2]+offset),
                    ];
                    break;
                }
                // Clamp to UV map boundaries
                if (Math.max(uv[0], uv[2]) > uv_width) {
                    let offset = Math.max(uv[0], uv[2]) - uv_width;
                    uv[0] -= offset;
                    uv[2] -= offset;
                }
                if (Math.min(uv[0], uv[2]) < 0) {
                    let offset = Math.min(uv[0], uv[2]);
                    uv[0] = Math.clamp(uv[0] - offset, 0, uv_width);
                    uv[2] = Math.clamp(uv[2] - offset, 0, uv_width);
                }
                if (Math.max(uv[1], uv[3]) > uv_height) {
                    let offset = Math.max(uv[1], uv[3]) - uv_height;
                    uv[1] -= offset;
                    uv[3] -= offset;
                }
                if (Math.min(uv[1], uv[3]) < 0) {
                    let offset = Math.min(uv[1], uv[3]);
                    uv[1] = Math.clamp(uv[1] - offset, 0, uv_height);
                    uv[3] = Math.clamp(uv[3] - offset, 0, uv_height);
                }
                scope.faces[side].uv = uv;
            })
            scope.preview_controller.updateUV(scope)
        } else if (scope.autouv === 1) {

            function calcAutoUV(fkey, dimension_axes, world_directions) {
                let size = dimension_axes.map(axis => scope.size(axis));
                let face = scope.faces[fkey];
                size[0] = Math.abs(size[0]);
                size[1] = Math.abs(size[1]);
                let sx = face.uv[0];
                let sy = face.uv[1];
                let previous_size = face.uv_size;
                let rot = face.rotation;

                let texture = face.getTexture();
                let uv_width = Project.getUVWidth(texture);
                let uv_height = Project.getUVHeight(texture);

                //Match To Rotation
                if (rot === 90 || rot === 270) {
                    size.reverse()
                    dimension_axes.reverse()
                    world_directions.reverse()
                }
                if (rot == 180) {
                    world_directions[0] *= -1;
                    world_directions[1] *= -1;
                }
                //Limit Input to 16
                size[0] = Math.clamp(size[0], -uv_width, uv_width) * (Math.sign(previous_size[0]) || 1);
                size[1] = Math.clamp(size[1], -uv_height, uv_height) * (Math.sign(previous_size[1]) || 1);

                if (options && typeof options.axis == 'number') {
                    if (options.axis == dimension_axes[0] && options.direction == world_directions[0]) {
                        sx += previous_size[0] - size[0];
                    }
                    if (options.axis == dimension_axes[1] && options.direction == world_directions[1]) {
                        sy += previous_size[1] - size[1];
                    }
                }

                //Prevent Negative
                if (sx < 0) sx = 0
                if (sy < 0) sy = 0
                //Calculate End Points
                let endx = sx + size[0];
                let endy = sy + size[1];
                //Prevent overflow
                if (endx > uv_width) {
                    sx = uv_width - (endx - sx)
                    endx = uv_width
                }
                if (endy > uv_height) {
                    sy = uv_height - (endy - sy)
                    endy = uv_height
                }
                //Return
                return [sx, sy, endx, endy]
            }
            scope.faces.north.uv = calcAutoUV('north', [0, 1], [1, 1]);
            scope.faces.east.uv =  calcAutoUV('east',  [2, 1], [1, 1]);
            scope.faces.south.uv = calcAutoUV('south', [0, 1], [-1, 1]);
            scope.faces.west.uv =  calcAutoUV('west',  [2, 1], [-1, 1]);
            scope.faces.up.uv =	   calcAutoUV('up',	   [0, 2], [-1, -1]);
            scope.faces.down.uv =  calcAutoUV('down',  [0, 2], [-1, 1]);

            scope.preview_controller.updateUV(scope)
        }
    }

    BarItems.group_elements.click = function () {
        Undo.initEdit({outliner: true, groups: []});
        let add_group = Group.first_selected
        if (!add_group && Outliner.selected.length) {
            add_group = Outliner.selected.last()
        }
        let new_name = add_group?.name;
        let base_group = new Group({
            origin: add_group ? add_group.origin : undefined,
            name: ['cube', 'mesh'].includes(new_name) ? undefined : new_name
        })
        base_group.sortInBefore(add_group);
        base_group.isOpen = true
        base_group.init();

        if (base_group.getTypeBehavior('unique_name')) {
            base_group.createUniqueName()
        }
        Outliner.selected.concat(Group.multi_selected).forEach((s) => {
            if (s.parent?.selected) return;
            s.addTo(base_group);
            s.preview_controller.updateTransform(s);
        })
        base_group.select()
        Undo.finishEdit('Add group', {outliner: true, groups: [base_group]});
        Vue.nextTick(function() {
            updateSelection()
            if (settings.create_rename.value) {
                base_group.rename()
            }
            base_group.showInOutliner()
            Blockbench.dispatchEvent( 'group_elements', {object: base_group} )
        })
    }
}