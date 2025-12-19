(() => {
  // src/cleanup.ts
  var list = [];
  function track(...items) {
    list.push(...items);
  }
  function cleanup() {
    for (let deletable of list) {
      deletable.delete();
    }
    list.empty();
  }

  // src/config.ts
  var Config = {
    json_compile_options: {
      indentation: "  ",
      final_newline: false
    }
  };

  // src/util.ts
  function qualifiesAsMainShape(object) {
    return object instanceof Cube && (object.rotation.allEqual(0) || cubeIsQuad(object));
  }
  function cubeIsQuad(cube) {
    return cube.size()[2] == 0;
  }
  function getMainShape(group) {
    return group.children.find(qualifiesAsMainShape);
  }

  // src/blockymodel.ts
  function discoverTexturePaths(dirname, modelName) {
    let fs = requireNativeModule("fs");
    let paths = [];
    let dirFiles = fs.readdirSync(dirname);
    for (let fileName of dirFiles) {
      if (fileName.match(/\.png$/i) && (fileName.startsWith(modelName) || fileName == "Texture.png")) {
        paths.push(PathModule.join(dirname, fileName));
      }
    }
    let texturesFolderPath = PathModule.join(dirname, `${modelName}_Textures`);
    if (fs.existsSync(texturesFolderPath) && fs.statSync(texturesFolderPath).isDirectory()) {
      let folderFiles = fs.readdirSync(texturesFolderPath);
      for (let fileName of folderFiles) {
        if (fileName.match(/\.png$/i)) {
          paths.push(PathModule.join(texturesFolderPath, fileName));
        }
      }
    }
    return [...new Set(paths)];
  }
  function loadTexturesFromPaths(paths, preferredName) {
    const textures = [];
    for (let texturePath of paths) {
      let texture = Texture.all.find((t) => t.path == texturePath);
      if (!texture) {
        texture = new Texture().fromPath(texturePath).add(false, true);
      }
      textures.push(texture);
    }
    if (textures.length > 0) {
      let primary = preferredName && textures.find((t) => t.name.startsWith(preferredName)) || textures[0];
      if (!Texture.all.find((t) => t.use_as_default)) {
        primary.use_as_default = true;
      }
    }
    return textures;
  }
  function promptForTextures(dirname) {
    Blockbench.showMessageBox({
      title: "Import Textures",
      message: "No textures were found for this model. How would you like to import textures?",
      buttons: ["Select Files", "Select Folder", "Skip"]
    }, (choice) => {
      let project = Project;
      if (choice === 2 || !project) return;
      if (choice === 0) {
        Blockbench.import({
          resource_id: "texture",
          extensions: ["png"],
          type: "PNG Textures",
          multiple: true,
          readtype: "image",
          startpath: dirname
        }, (files) => {
          if (Project !== project || files.length === 0) return;
          let paths = files.map((f) => f.path).filter((p) => !!p);
          loadTexturesFromPaths(paths);
        });
      } else if (choice === 1) {
        let folderPath = Blockbench.pickDirectory({
          title: "Select Texture Folder",
          startpath: dirname,
          resource_id: "texture"
        });
        if (folderPath && Project === project) {
          let fs = requireNativeModule("fs");
          let files = fs.readdirSync(folderPath);
          let pngFiles = files.filter((f) => f.match(/\.png$/i));
          if (pngFiles.length === 0) {
            Blockbench.showQuickMessage("No PNG files found in selected folder");
            return;
          }
          let paths = pngFiles.map((f) => PathModule.join(folderPath, f));
          loadTexturesFromPaths(paths);
        }
      }
    });
  }
  function setupBlockymodelCodec() {
    let codec = new Codec("blockymodel", {
      name: "Hytale Blockymodel",
      extension: "blockymodel",
      remember: true,
      support_partial_export: true,
      load_filter: {
        type: "json",
        extensions: ["blockymodel"]
      },
      load(model, file, args = {}) {
        let path_segments = file.path && file.path.split(/[\\\/]/);
        let format = this.format;
        if (model.format) {
          if (model.format == "prop") {
            format = Formats.hytale_prop;
          }
        } else {
          if (path_segments && path_segments.includes("Blocks")) {
            format = Formats.hytale_prop;
          }
        }
        if (!args.import_to_current_project) {
          setupProject(format);
        }
        if (path_segments && isApp && this.remember && !file.no_file) {
          path_segments[path_segments.length - 1] = path_segments.last().split(".")[0];
          Project.name = path_segments.findLast((p) => p != "Model" && p != "Models" && p != "Attachments") ?? "Model";
          Project.export_path = file.path;
        }
        this.parse(model, file.path, args);
        if (file.path && isApp && this.remember && !file.no_file) {
          addRecentProject({
            name: Project.name,
            path: Project.export_path,
            icon: Format.icon
          });
          let project = Project;
          setTimeout(() => {
            if (Project == project) updateRecentProjectThumbnail();
          }, 500);
        }
        Settings.updateSettingsInProfiles();
      },
      compile(options = {}) {
        let model = {
          nodes: [],
          format: Format.id == "hytale_prop" ? "prop" : "character",
          lod: "auto"
        };
        let node_id = 1;
        let formatVector = (input) => {
          return new oneLiner({
            x: input[0],
            y: input[1],
            z: input[2]
          });
        };
        function turnNodeIntoBox(node, cube, original_element) {
          let size = cube.size();
          let stretch = cube.stretch.slice();
          let offset = [
            Math.lerp(cube.from[0], cube.to[0], 0.5) - original_element.origin[0],
            Math.lerp(cube.from[1], cube.to[1], 0.5) - original_element.origin[1],
            Math.lerp(cube.from[2], cube.to[2], 0.5) - original_element.origin[2]
          ];
          node.shape.type = "box";
          node.shape.settings.size = formatVector(size);
          node.shape.offset = formatVector(offset);
          let temp;
          function switchIndices(arr, i1, i2) {
            temp = arr[i1];
            arr[i1] = arr[i2];
            arr[i2] = temp;
          }
          if (cubeIsQuad(cube)) {
            node.shape.type = "quad";
            if (cube.rotation[0] == -90) {
              node.shape.settings.normal = "+Y";
              switchIndices(stretch, 1, 2);
            } else if (cube.rotation[0] == 90) {
              node.shape.settings.normal = "-Y";
              switchIndices(stretch, 1, 2);
            } else if (cube.rotation[1] == 90) {
              node.shape.settings.normal = "+X";
              switchIndices(stretch, 0, 2);
            } else if (cube.rotation[1] == -90) {
              node.shape.settings.normal = "-X";
              switchIndices(stretch, 0, 2);
            } else if (cube.rotation[1] == 180) {
              node.shape.settings.normal = "-Z";
            } else {
              node.shape.settings.normal = "+Z";
            }
          }
          node.shape.stretch = formatVector(stretch);
          node.shape.visible = true;
          node.shape.doubleSided = cube.double_sided == true;
          node.shape.shadingMode = cube.shading_mode;
          node.shape.unwrapMode = "custom";
          if (cube == original_element) {
            node.shape.settings.isStaticBox = true;
          }
          const BBToHytaleDirection = {
            north: "back",
            south: "front",
            west: "left",
            east: "right",
            up: "top",
            down: "bottom"
          };
          let faces = node.shape.type == "quad" ? ["south", "north"] : Object.keys(cube.faces);
          for (let fkey of faces) {
            let flipMinMax = function(axis) {
              if (axis == 0 /* X */) {
                flip_x = !flip_x;
                if (flip_x) {
                  uv_x = Math.max(face.uv[0], face.uv[2]);
                } else {
                  uv_x = Math.min(face.uv[0], face.uv[2]);
                }
              } else {
                flip_y = !flip_y;
                if (flip_y) {
                  uv_y = Math.max(face.uv[1], face.uv[3]);
                } else {
                  uv_y = Math.min(face.uv[1], face.uv[3]);
                }
              }
            };
            let face = cube.faces[fkey];
            if (face.texture == null) continue;
            let direction = BBToHytaleDirection[fkey];
            let flip_x = false;
            let flip_y = false;
            let uv_x = Math.min(face.uv[0], face.uv[2]);
            let uv_y = Math.min(face.uv[1], face.uv[3]);
            let UVAxis;
            ((UVAxis2) => {
              UVAxis2[UVAxis2["X"] = 0] = "X";
              UVAxis2[UVAxis2["Y"] = 1] = "Y";
            })(UVAxis || (UVAxis = {}));
            let mirror_x = false;
            let mirror_y = false;
            if (face.uv[0] > face.uv[2]) {
              mirror_x = true;
              flipMinMax(0 /* X */);
            }
            if (face.uv[1] > face.uv[3]) {
              mirror_y = true;
              flipMinMax(1 /* Y */);
            }
            let uv_rot = 0;
            switch (face.rotation) {
              case 90: {
                uv_rot = 270;
                if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) {
                  uv_rot = 90;
                }
                flipMinMax(1 /* Y */);
                break;
              }
              case 180: {
                uv_rot = 180;
                flipMinMax(1 /* Y */);
                flipMinMax(0 /* X */);
                break;
              }
              case 270: {
                uv_rot = 90;
                if ((mirror_x || mirror_y) && !(mirror_x && mirror_y)) {
                  uv_rot = 270;
                }
                flipMinMax(0 /* X */);
                break;
              }
            }
            let layout_face = {
              offset: new oneLiner({ x: Math.trunc(uv_x), y: Math.trunc(uv_y) }),
              mirror: new oneLiner({ x: mirror_x, y: mirror_y }),
              angle: uv_rot
            };
            node.shape.textureLayout[direction] = layout_face;
          }
        }
        function getNodeOffset(group) {
          let cube = getMainShape(group);
          if (cube) {
            let center_pos = cube.from.slice().V3_add(cube.to).V3_divide(2, 2, 2);
            center_pos.V3_subtract(group.origin);
            return center_pos;
          }
        }
        function compileNode(element) {
          if (!options.attachment) {
            let collection = Collection.all.find((c) => c.contains(element));
            if (collection) return;
          }
          let euler = Reusable.euler1.set(
            Math.degToRad(element.rotation[0]),
            Math.degToRad(element.rotation[1]),
            Math.degToRad(element.rotation[2]),
            element.scene_object.rotation.order
          );
          let quaternion = Reusable.quat1.setFromEuler(euler);
          let orientation = new oneLiner({
            x: quaternion.x,
            y: quaternion.y,
            z: quaternion.z,
            w: quaternion.w
          });
          let origin = element.origin.slice();
          if (element.parent instanceof Group) {
            origin.V3_subtract(element.parent.origin);
            let offset = getNodeOffset(element.parent);
            if (offset) {
              origin.V3_subtract(offset);
            }
          }
          let node = {
            id: node_id.toString(),
            name: element.name.replace(/^.+:/, ""),
            position: formatVector(origin),
            orientation,
            shape: {
              type: "none",
              offset: formatVector([0, 0, 0]),
              stretch: formatVector([0, 0, 0]),
              settings: {
                isPiece: element instanceof Group && element.is_piece || false
              },
              textureLayout: {},
              unwrapMode: "custom",
              visible: true,
              doubleSided: false,
              shadingMode: "flat"
            }
          };
          node_id++;
          if (element instanceof Cube) {
            turnNodeIntoBox(node, element, element);
          } else if ("children" in element) {
            let shape_count = 0;
            for (let child of element.children ?? []) {
              let result;
              if (qualifiesAsMainShape(child) && shape_count == 0) {
                turnNodeIntoBox(node, child, element);
                shape_count++;
              } else if (child instanceof Cube) {
                result = compileNode(child);
              } else if (child instanceof Group) {
                result = compileNode(child);
              }
              if (result) {
                if (!node.children) node.children = [];
                node.children.push(result);
              }
            }
          }
          return node;
        }
        let groups = Outliner.root.filter((g) => g instanceof Group);
        if (options.attachment instanceof Collection) {
          groups = options.attachment.getChildren().filter((g) => g instanceof Group);
        }
        for (let group of groups) {
          let compiled = group instanceof Group && compileNode(group);
          if (compiled) model.nodes.push(compiled);
        }
        if (options.raw) {
          return model;
        } else {
          return compileJSON(model, Config.json_compile_options);
        }
      },
      parse(model, path, args = {}) {
        function parseVector(vec, fallback = [0, 0, 0]) {
          if (!vec) return fallback;
          return Object.values(vec).slice(0, 3);
        }
        const new_groups = [];
        const existing_groups = Group.all.slice();
        function parseNode(node, parent_node, parent_group = "root", parent_offset) {
          if (args.attachment) {
            let attachment_node;
            if (args.attachment && node.shape?.settings?.isPiece === true && existing_groups.length) {
              let node_name = node.name;
              attachment_node = existing_groups.find((g) => g.name == node_name);
            }
            if (attachment_node) {
              parent_group = attachment_node;
              parent_node = null;
            }
          }
          let quaternion = new THREE.Quaternion();
          quaternion.set(node.orientation.x, node.orientation.y, node.orientation.z, node.orientation.w);
          let rotation_euler = new THREE.Euler().setFromQuaternion(quaternion.normalize(), "ZYX");
          let name = node.name;
          let offset = node.shape?.offset ? parseVector(node.shape?.offset) : [0, 0, 0];
          let origin = parseVector(node.position);
          let rotation = [
            Math.radToDeg(rotation_euler.x),
            Math.radToDeg(rotation_euler.y),
            Math.radToDeg(rotation_euler.z)
          ];
          if (args.attachment && !parent_node && parent_group instanceof Group) {
            let reference_node = getMainShape(parent_group) ?? parent_group;
            origin = reference_node.origin.slice();
            rotation = reference_node.rotation.slice();
          } else if (parent_group instanceof Group) {
            let parent_geo_origin = getMainShape(parent_group)?.origin ?? parent_group.origin;
            if (parent_geo_origin) {
              origin.V3_add(parent_geo_origin);
              if (parent_offset) origin.V3_add(parent_offset);
            }
          }
          let group = null;
          if (!node.shape?.settings?.isStaticBox) {
            group = new Group({
              name,
              autouv: 1,
              origin,
              rotation
            });
            new_groups.push(group);
            group.addTo(parent_group);
            if (!parent_node && args.attachment) {
              group.name = args.attachment + ":" + group.name;
              group.color = 1;
            }
            group.init();
            group.extend({
              // @ts-ignore
              is_piece: node.shape?.settings?.isPiece ?? false
            });
          }
          if (node.shape.type != "none") {
            let switchIndices = function(arr, i1, i2) {
              temp = arr[i1];
              arr[i1] = arr[i2];
              arr[i2] = temp;
            };
            let size = parseVector(node.shape.settings.size);
            let stretch = parseVector(node.shape.stretch, [1, 1, 1]);
            if (node.shape.type == "quad") {
              size[2] = 0;
            }
            let cube = new Cube({
              name,
              autouv: 1,
              rotation: [0, 0, 0],
              stretch,
              from: [
                -size[0] / 2 + origin[0] + offset[0],
                -size[1] / 2 + origin[1] + offset[1],
                -size[2] / 2 + origin[2] + offset[2]
              ],
              to: [
                size[0] / 2 + origin[0] + offset[0],
                size[1] / 2 + origin[1] + offset[1],
                size[2] / 2 + origin[2] + offset[2]
              ]
            });
            if (group) {
              cube.origin.V3_set(
                Math.lerp(cube.from[0], cube.to[0], 0.5),
                Math.lerp(cube.from[1], cube.to[1], 0.5),
                Math.lerp(cube.from[2], cube.to[2], 0.5)
              );
            } else {
              cube.extend({
                origin,
                rotation
              });
            }
            cube.extend({
              // @ts-ignore
              shading_mode: node.shape.shadingMode,
              double_sided: node.shape.doubleSided
            });
            let temp;
            if (node.shape.settings?.normal && node.shape.settings.normal != "+Z") {
              switch (node.shape.settings.normal) {
                case "+Y": {
                  cube.rotation[0] -= 90;
                  switchIndices(cube.stretch, 1, 2);
                  break;
                }
                case "-Y": {
                  cube.rotation[0] += 90;
                  switchIndices(cube.stretch, 1, 2);
                  break;
                }
                case "+X": {
                  cube.rotation[1] += 90;
                  switchIndices(cube.stretch, 0, 2);
                  break;
                }
                case "-X": {
                  cube.rotation[1] -= 90;
                  switchIndices(cube.stretch, 0, 2);
                  break;
                }
                case "-Z": {
                  cube.rotation[1] += 180;
                  break;
                }
              }
            }
            let HytaleDirection;
            ((HytaleDirection2) => {
              HytaleDirection2["back"] = "back";
              HytaleDirection2["front"] = "front";
              HytaleDirection2["left"] = "left";
              HytaleDirection2["right"] = "right";
              HytaleDirection2["top"] = "top";
              HytaleDirection2["bottom"] = "bottom";
            })(HytaleDirection || (HytaleDirection = {}));
            const HytaleToBBDirection = {
              back: "north",
              front: "south",
              left: "west",
              right: "east",
              top: "up",
              bottom: "down"
            };
            if (node.shape.settings.size) {
              let parseUVVector = function(vec, fallback = [0, 0]) {
                if (!vec) return fallback;
                return Object.values(vec).slice(0, 2);
              };
              for (let key in HytaleDirection) {
                let uv_source = node.shape.textureLayout[key];
                let face_name = HytaleToBBDirection[key];
                if (!uv_source) {
                  cube.faces[face_name].texture = null;
                  cube.faces[face_name].uv = [0, 0, 0, 0];
                  continue;
                }
                let uv_offset = parseUVVector(uv_source.offset);
                let uv_size = [
                  size[0],
                  size[1]
                ];
                let uv_mirror = [
                  uv_source.mirror.x ? -1 : 1,
                  uv_source.mirror.y ? -1 : 1
                ];
                let uv_rotation = uv_source.angle;
                switch (key) {
                  case "left": {
                    uv_size[0] = size[2];
                    break;
                  }
                  case "right": {
                    uv_size[0] = size[2];
                    break;
                  }
                  case "top": {
                    uv_size[1] = size[2];
                    break;
                  }
                  case "bottom": {
                    uv_size[1] = size[2];
                    break;
                  }
                }
                let result = [0, 0, 0, 0];
                switch (uv_rotation) {
                  case 90: {
                    switchIndices(uv_size, 0, 1);
                    switchIndices(uv_mirror, 0, 1);
                    uv_mirror[0] *= -1;
                    result = [
                      uv_offset[0],
                      uv_offset[1] + uv_size[1] * uv_mirror[1],
                      uv_offset[0] + uv_size[0] * uv_mirror[0],
                      uv_offset[1]
                    ];
                    break;
                  }
                  case 270: {
                    switchIndices(uv_size, 0, 1);
                    switchIndices(uv_mirror, 0, 1);
                    uv_mirror[1] *= -1;
                    result = [
                      uv_offset[0] + uv_size[0] * uv_mirror[0],
                      uv_offset[1],
                      uv_offset[0],
                      uv_offset[1] + uv_size[1] * uv_mirror[1]
                    ];
                    break;
                  }
                  case 180: {
                    uv_mirror[0] *= -1;
                    uv_mirror[1] *= -1;
                    result = [
                      uv_offset[0] + uv_size[0] * uv_mirror[0],
                      uv_offset[1] + uv_size[1] * uv_mirror[1],
                      uv_offset[0],
                      uv_offset[1]
                    ];
                    break;
                  }
                  case 0: {
                    result = [
                      uv_offset[0],
                      uv_offset[1],
                      uv_offset[0] + uv_size[0] * uv_mirror[0],
                      uv_offset[1] + uv_size[1] * uv_mirror[1]
                    ];
                    break;
                  }
                }
                cube.faces[face_name].rotation = uv_rotation;
                cube.faces[face_name].uv = result;
              }
            }
            cube.addTo(group || parent_group).init();
          }
          if (node.children?.length && group instanceof Group) {
            for (let child of node.children) {
              parseNode(child, node, group);
            }
          }
        }
        for (let node of model.nodes) {
          parseNode(node, null);
        }
        let new_textures = [];
        if (isApp && path) {
          let project = Project;
          let dirname = PathModule.dirname(path);
          let model_file_name = pathToName(path, false);
          let fs = requireNativeModule("fs");
          let texture_paths = discoverTexturePaths(dirname, model_file_name);
          if (texture_paths.length > 0 && !args.attachment) {
            new_textures = loadTexturesFromPaths(texture_paths, Project.name);
          } else if (texture_paths.length > 0) {
            new_textures = loadTexturesFromPaths(texture_paths);
          }
          if (new_textures.length === 0 && !args.attachment) {
            setTimeout(() => {
              if (Project !== project) return;
              promptForTextures(dirname);
            }, 100);
          }
          if (!args?.attachment) {
            let listener = Blockbench.on("select_mode", ({ mode }) => {
              if (mode.id != "animate" || project != Project) return;
              listener.delete();
              let anim_path = PathModule.resolve(dirname, "../Animations/");
              try {
                let anim_folders = fs.existsSync(anim_path) ? fs.readdirSync(anim_path) : [];
                for (let folder of anim_folders) {
                  if (folder.includes(".")) continue;
                  let path2 = PathModule.resolve(anim_path, folder);
                  let anim_files = fs.readdirSync(path2);
                  for (let file_name of anim_files) {
                    if (file_name.match(/\.blockyanim$/i)) {
                      let file_path = PathModule.resolve(path2, file_name);
                      let content = fs.readFileSync(file_path, "utf-8");
                      let json = autoParseJSON(content);
                      parseAnimationFile({ name: file_name, path: file_path }, json);
                    }
                  }
                }
              } catch (err) {
                console.error(err);
              }
            });
          }
        }
        return { new_groups, new_textures };
      },
      async export(options) {
        if (Object.keys(this.export_options).length) {
          let result = await this.promptExportOptions();
          if (result === null) return;
        }
        Blockbench.export({
          resource_id: "model",
          type: this.name,
          extensions: [this.extension],
          name: this.fileName(),
          startpath: this.startPath(),
          content: this.compile(options),
          custom_writer: isApp ? (a, b) => this.write(a, b) : null
        }, (path) => this.afterDownload(path));
      },
      async exportCollection(collection) {
        await this.export({ attachment: collection });
      },
      async writeCollection(collection) {
        this.write(this.compile({ attachment: collection }), collection.export_path);
      }
    });
    let export_action = new Action("export_blockymodel", {
      name: "Export Hytale Blockymodel",
      description: "Export a blockymodel file",
      icon: "icon-format_hytale",
      category: "file",
      condition: { formats: FORMAT_IDS },
      click: function() {
        codec.export();
      }
    });
    codec.export_action = export_action;
    track(codec, export_action);
    MenuBar.menus.file.addAction(export_action, "export.1");
    let hook = Blockbench.on("quick_save_model", () => {
      if (FORMAT_IDS.includes(Format.id) == false) return;
      for (let collection of Collection.all) {
        if (collection.export_codec != codec.id) continue;
        codec.writeCollection(collection);
      }
    });
    track(hook);
    return codec;
  }

  // src/attachment_texture.ts
  var attachmentMaterials = /* @__PURE__ */ new Map();
  function getTextureFilePath(collection) {
    if (!collection.texture_path) return "";
    let fs = requireNativeModule("fs");
    if (!fs.existsSync(collection.texture_path)) return "";
    let stat = fs.statSync(collection.texture_path);
    if (stat.isFile()) {
      return collection.texture_path;
    }
    if (stat.isDirectory() && collection.selected_texture) {
      return PathModule.join(collection.texture_path, collection.selected_texture);
    }
    return "";
  }
  function isTextureSingleFile(collection) {
    if (!collection.texture_path) return false;
    let fs = requireNativeModule("fs");
    if (!fs.existsSync(collection.texture_path)) return false;
    return fs.statSync(collection.texture_path).isFile();
  }
  function scanTexturesAtPath(texturePath) {
    let fs = requireNativeModule("fs");
    let textures = [];
    if (!texturePath || !fs.existsSync(texturePath)) return textures;
    let stat = fs.statSync(texturePath);
    if (stat.isFile() && texturePath.match(/\.png$/i)) {
      textures.push({
        name: PathModule.basename(texturePath),
        path: texturePath,
        dataUrl: texturePath
      });
    } else if (stat.isDirectory()) {
      for (let fileName of fs.readdirSync(texturePath)) {
        if (fileName.match(/\.png$/i)) {
          let filePath = PathModule.join(texturePath, fileName);
          textures.push({ name: fileName, path: filePath, dataUrl: filePath });
        }
      }
    }
    return textures;
  }
  function clearAttachmentMaterial(uuid) {
    let cached = attachmentMaterials.get(uuid);
    if (cached) {
      cached.image.src = "";
      cached.texture.dispose();
      cached.material.dispose();
      attachmentMaterials.delete(uuid);
    }
  }
  function clearAllAttachmentMaterials() {
    for (let [, data] of attachmentMaterials) {
      data.image.src = "";
      data.texture.dispose();
      data.material.dispose();
    }
    attachmentMaterials.clear();
  }
  function getAttachmentMaterial(collection) {
    let cached = attachmentMaterials.get(collection.uuid);
    if (cached) return cached.material;
    let texturePath = getTextureFilePath(collection);
    if (!texturePath) return null;
    let fs = requireNativeModule("fs");
    if (!fs.existsSync(texturePath)) return null;
    let canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    let tex = new THREE.Texture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    let mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { type: "t", value: tex },
        SHADE: { type: "bool", value: settings.shading.value },
        LIGHTCOLOR: { type: "vec3", value: new THREE.Color().copy(Canvas.global_light_color).multiplyScalar(settings.brightness.value / 50) },
        LIGHTSIDE: { type: "int", value: Canvas.global_light_side },
        EMISSIVE: { type: "bool", value: false }
      },
      vertexShader: Texture.all[0]?.getMaterial()?.vertexShader || "",
      fragmentShader: Texture.all[0]?.getMaterial()?.fragmentShader || "",
      side: THREE.DoubleSide,
      transparent: true
    });
    mat.map = tex;
    let img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      let ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        tex.needsUpdate = true;
        Canvas.updateAllFaces();
      }
    };
    img.src = texturePath;
    attachmentMaterials.set(collection.uuid, { material: mat, texture: tex, image: img });
    return mat;
  }
  function getCollection(cube) {
    return Collection.all.find((c) => c.contains(cube));
  }
  function injectTextureSection(collection) {
    let dialogEl = document.getElementById("collection_properties");
    if (!dialogEl) return;
    let dialogContent = dialogEl.querySelector(".dialog_content");
    if (!dialogContent) return;
    if (dialogEl.querySelector("#attachment_texture_section")) return;
    let section = document.createElement("div");
    section.id = "attachment_texture_section";
    section.innerHTML = buildTextureSectionHTML(collection);
    dialogContent.appendChild(section);
    setupTextureSectionHandlers(section, collection);
  }
  function buildTextureSectionHTML(collection) {
    let textures = scanTexturesAtPath(collection.texture_path);
    let isSingleFile = isTextureSingleFile(collection);
    let gridContent = textures.length === 0 ? '<div style="flex: 1; text-align: center; color: var(--color-subtle_text); padding: 16px;">No textures found</div>' : textures.map((tex) => {
      let isSelected = isSingleFile || collection.selected_texture === tex.name;
      return `
				<div class="att_tex_item${isSelected ? " selected" : ""}" data-name="${tex.name}" data-path="${tex.path}">
					<img src="${tex.dataUrl}">
					<div class="att_tex_name">${tex.name}</div>
				</div>
			`;
    }).join("");
    return `
		<div class="dialog_bar form_bar form_bar_file">
			<label class="name_space_left">Texture Path</label>
			<div class="input_wrapper">
				<input type="text" class="dark_bordered" id="att_tex_path" value="${collection.texture_path || ""}">
				<i class="material-icons" id="att_browse_btn" style="cursor: pointer;">folder_open</i>
			</div>
		</div>

		<div id="att_tex_grid" style="display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; padding-bottom: 4px;">
			${gridContent}
		</div>

		<style>
			#att_tex_grid .att_tex_item { cursor: pointer; text-align: center; padding: 6px; border-radius: 4px; background: var(--color-back); border: 2px solid transparent; flex-shrink: 0; width: 88px; }
			#att_tex_grid .att_tex_item.selected { border-color: var(--color-accent); background: var(--color-selected); }
			#att_tex_grid .att_tex_item:hover:not(.selected) { background: var(--color-button); }
			#att_tex_grid .att_tex_item img { width: 76px; height: 76px; object-fit: contain; image-rendering: pixelated; }
			#att_tex_grid .att_tex_name { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 76px; }
		</style>
	`;
  }
  function setupTextureSectionHandlers(section, collection) {
    let pathInput = section.querySelector("#att_tex_path");
    function refreshGrid() {
      let grid = section.querySelector("#att_tex_grid");
      if (!grid) return;
      let textures = scanTexturesAtPath(collection.texture_path);
      let isSingleFile = isTextureSingleFile(collection);
      grid.innerHTML = textures.length === 0 ? '<div style="flex: 1; text-align: center; color: var(--color-subtle_text); padding: 16px;">No textures found</div>' : textures.map((tex) => {
        let isSelected = isSingleFile || collection.selected_texture === tex.name;
        return `
					<div class="att_tex_item${isSelected ? " selected" : ""}" data-name="${tex.name}" data-path="${tex.path}">
						<img src="${tex.dataUrl}">
						<div class="att_tex_name">${tex.name}</div>
					</div>
				`;
      }).join("");
      attachGridClickHandlers();
    }
    function attachGridClickHandlers() {
      section.querySelectorAll("#att_tex_grid .att_tex_item").forEach((item) => {
        item.addEventListener("click", () => {
          section.querySelectorAll("#att_tex_grid .att_tex_item").forEach((i) => i.classList.remove("selected"));
          item.classList.add("selected");
          if (!isTextureSingleFile(collection)) {
            collection.selected_texture = item.getAttribute("data-name") || "";
          }
          clearAttachmentMaterial(collection.uuid);
          Canvas.updateAllFaces();
        });
      });
    }
    attachGridClickHandlers();
    section.querySelector("#att_browse_btn")?.addEventListener("click", () => {
      let startPath = collection.texture_path || (collection.export_path ? PathModule.dirname(collection.export_path) : "");
      let folderPath = Blockbench.pickDirectory({
        title: "Select Texture Folder",
        startpath: startPath,
        resource_id: "texture"
      });
      if (folderPath) {
        collection.texture_path = folderPath;
        pathInput.value = folderPath;
        clearAttachmentMaterial(collection.uuid);
        let textures = scanTexturesAtPath(folderPath);
        if (textures.length > 0) {
          collection.selected_texture = textures[0].name;
          getAttachmentMaterial(collection);
        }
        refreshGrid();
        Canvas.updateAllFaces();
      }
    });
    pathInput?.addEventListener("change", () => {
      let fs = requireNativeModule("fs");
      let newPath = pathInput.value;
      if (!newPath || !fs.existsSync(newPath)) return;
      collection.texture_path = newPath;
      clearAttachmentMaterial(collection.uuid);
      if (fs.statSync(newPath).isFile()) {
        collection.selected_texture = "";
      } else {
        let textures = scanTexturesAtPath(newPath);
        if (textures.length > 0) {
          collection.selected_texture = textures[0].name;
        }
      }
      getAttachmentMaterial(collection);
      refreshGrid();
      Canvas.updateAllFaces();
    });
  }
  function setupAttachmentTextures() {
    let texture_path_property = new Property(Collection, "string", "texture_path", {
      condition: { formats: FORMAT_IDS }
    });
    track(texture_path_property);
    let selected_texture_property = new Property(Collection, "string", "selected_texture", {
      condition: { formats: FORMAT_IDS }
    });
    track(selected_texture_property);
    let originalGetTexture = CubeFace.prototype.getTexture;
    CubeFace.prototype.getTexture = function(...args) {
      if (isHytaleFormat()) {
        if (this.texture == null) return null;
        let collection = getCollection(this.cube);
        if (collection?.export_codec === "blockymodel") {
          if (collection.texture_path) {
            let material = getAttachmentMaterial(collection);
            if (material) {
              let cached = attachmentMaterials.get(collection.uuid);
              let img = cached?.image;
              let width = img?.naturalWidth || 64;
              let height = img?.naturalHeight || 64;
              return {
                uuid: collection.uuid + "_tex",
                getMaterial: () => material,
                getOwnMaterial: () => material,
                img,
                width,
                height,
                uv_width: width,
                uv_height: height,
                display_height: height,
                frameCount: 1,
                currentFrame: 0,
                getUVWidth: () => width,
                getUVHeight: () => height,
                source: cached?.image?.src || "",
                selected: false,
                show_icon: true,
                particle: false,
                use_as_default: false
              };
            }
          }
          return null;
        }
      }
      return originalGetTexture.call(this, ...args);
    };
    track({ delete() {
      CubeFace.prototype.getTexture = originalGetTexture;
    } });
    let originalPropertiesDialog = Collection.prototype.propertiesDialog;
    Collection.prototype.propertiesDialog = function() {
      originalPropertiesDialog.call(this);
      if (isHytaleFormat() && this.export_codec === "blockymodel") {
        setTimeout(() => injectTextureSection(this), 10);
      }
    };
    track({ delete() {
      Collection.prototype.propertiesDialog = originalPropertiesDialog;
    } });
    track({ delete() {
      clearAllAttachmentMaterials();
    } });
  }

  // src/attachments.ts
  var reload_all_attachments;
  function setupAttachments() {
    setupAttachmentTextures();
    let originalRemove = null;
    function ensureIntercepted() {
      if (originalRemove) return;
      if (!Collection.all) return;
      originalRemove = Collection.all.remove;
      Collection.all.remove = function(...items) {
        if (isHytaleFormat()) {
          for (let collection of items) {
            if (collection.export_codec === "blockymodel") {
              for (let child of collection.getChildren()) {
                child.remove();
              }
              clearAttachmentMaterial(collection.uuid);
            }
          }
        }
        return originalRemove.apply(this, items);
      };
    }
    let handler = Blockbench.on("select_project", ensureIntercepted);
    track(handler);
    track({
      delete() {
        if (originalRemove) Collection.all.remove = originalRemove;
      }
    });
    let import_as_attachment = new Action("import_as_hytale_attachment", {
      name: "Import Attachment",
      icon: "fa-hat-cowboy",
      condition: { formats: FORMAT_IDS },
      click() {
        Filesystem.importFile({
          extensions: ["blockymodel"],
          type: "Blockymodel",
          multiple: true,
          startpath: Project.export_path.replace(/[\\\/]\w+.\w+$/, "") + osfs + "Attachments"
        }, (files) => {
          let fs = requireNativeModule("fs");
          for (let file of files) {
            let json = autoParseJSON(file.content);
            let attachment_name = file.name.replace(/\.\w+$/, "");
            let content = Codecs.blockymodel.parse(json, file.path, { attachment: attachment_name });
            let name = file.name.split(".")[0];
            let new_groups = content.new_groups;
            let root_groups = new_groups.filter((group) => !new_groups.includes(group.parent));
            let collection = new Collection({
              name,
              children: root_groups.map((g) => g.uuid),
              export_codec: "blockymodel",
              visibility: true
            }).add();
            collection.export_path = file.path;
            let createdTextures = content.new_textures;
            for (let tex of createdTextures) {
              tex.remove();
            }
            let dirname = PathModule.dirname(file.path);
            let texturePaths = discoverTexturePaths(dirname, attachment_name);
            if (texturePaths.length > 0) {
              let texturesFolderPath = PathModule.join(dirname, `${attachment_name}_Textures`);
              let hasTexturesFolder = fs.existsSync(texturesFolderPath) && fs.statSync(texturesFolderPath).isDirectory();
              if (hasTexturesFolder) {
                collection.texture_path = texturesFolderPath;
                let folderTextures = texturePaths.filter((p) => p.startsWith(texturesFolderPath));
                if (folderTextures.length > 0) {
                  collection.selected_texture = PathModule.basename(folderTextures[0]);
                }
              } else if (texturePaths.length === 1) {
                collection.texture_path = texturePaths[0];
                collection.selected_texture = "";
              } else {
                collection.texture_path = dirname;
                collection.selected_texture = PathModule.basename(texturePaths[0]);
              }
              getAttachmentMaterial(collection);
            }
            Canvas.updateAllFaces();
          }
        });
      }
    });
    track(import_as_attachment);
    let toolbar = Panels.collections.toolbars[0];
    toolbar.add(import_as_attachment);
    function reloadAttachment(collection) {
      for (let child of collection.getChildren()) {
        child.remove();
      }
      clearAttachmentMaterial(collection.uuid);
      Filesystem.readFile([collection.export_path], {}, ([file]) => {
        let json = autoParseJSON(file.content);
        let content = Codecs.blockymodel.parse(json, file.path, { attachment: collection.name });
        let new_groups = content.new_groups;
        let root_groups = new_groups.filter((group) => !new_groups.includes(group.parent));
        let createdTextures = content.new_textures;
        for (let tex of createdTextures) {
          tex.remove();
        }
        collection.extend({
          children: root_groups.map((g) => g.uuid)
        }).add();
        let attCollection = collection;
        if (attCollection.texture_path) {
          getAttachmentMaterial(attCollection);
        }
        Canvas.updateAllFaces();
      });
    }
    let reload_attachment_action = new Action("reload_hytale_attachment", {
      name: "Reload Attachment",
      icon: "refresh",
      condition: () => Collection.selected.length && Modes.edit,
      click() {
        for (let collection of Collection.selected) {
          reloadAttachment(collection);
        }
      }
    });
    Collection.menu.addAction(reload_attachment_action, 10);
    track(reload_attachment_action);
    let remove_attachment_action = new Action("remove_hytale_attachment", {
      name: "Remove Attachment",
      icon: "remove_selection",
      condition: () => Collection.selected.length && Modes.edit,
      click() {
        for (let collection of [...Collection.selected]) {
          Collection.all.remove(collection);
        }
      }
    });
    Collection.menu.addAction(remove_attachment_action, 11);
    track(remove_attachment_action);
    reload_all_attachments = new Action("reload_all_hytale_attachments", {
      name: "Reload All Attachments",
      icon: "sync",
      condition: { formats: FORMAT_IDS },
      click() {
        for (let collection of Collection.all.filter((c) => c.export_path)) {
          reloadAttachment(collection);
        }
      }
    });
    track(reload_all_attachments);
    toolbar.add(reload_all_attachments);
  }

  // src/formats.ts
  var FORMAT_IDS = [
    "hytale_character",
    "hytale_prop"
  ];
  function setupFormats() {
    let codec = setupBlockymodelCodec();
    let common = {
      category: "hytale",
      target: "Hytale",
      codec,
      forward_direction: "+z",
      single_texture_default: true,
      animation_files: true,
      animation_grouping: "custom",
      animation_mode: true,
      bone_rig: true,
      centered_grid: true,
      box_uv: false,
      optional_box_uv: true,
      uv_rotation: true,
      rotate_cubes: true,
      per_texture_uv_size: true,
      stretch_cubes: true,
      confidential: true,
      model_identifier: false,
      animation_loop_wrapping: true,
      quaternion_interpolation: true,
      onActivation() {
        settings.shading.set(false);
        Panels.animations.inside_vue.$data.group_animations_by_file = false;
      }
    };
    let format_page = {
      content: [
        { type: "h3", text: tl("mode.start.format.informations") },
        {
          text: `* One texture can be applied to a model at a time
                    * UV sizes are linked to the size of each cube and cannot be modified, except by stretching the cube
                    * Models can have a maximum of 255 nodes`.replace(/(\t| {4,4})+/g, "")
        },
        { type: "h3", text: tl("mode.start.format.resources") },
        {
          text: [
            "* [Modeling Tutorial](https://hytale.com/)",
            "* [Animation Tutorial](https://hytale.com/)"
          ].join("\n")
        }
      ]
    };
    let format_character = new ModelFormat("hytale_character", {
      name: "Hytale Character",
      description: "Create character and attachment models using Hytale's blockymodel format",
      icon: "icon-format_hytale",
      format_page,
      block_size: 64,
      ...common,
      onActivation() {
        common.onActivation?.();
        setTimeout(() => reload_all_attachments?.click(), 0);
      }
    });
    let format_prop = new ModelFormat("hytale_prop", {
      name: "Hytale Prop",
      description: "Create prop models using Hytale's blockymodel format",
      icon: "icon-format_hytale",
      format_page,
      block_size: 32,
      ...common
    });
    codec.format = format_character;
    track(format_character);
    track(format_prop);
    Language.addTranslations("en", {
      "format_category.hytale": "Hytale"
    });
  }
  function isHytaleFormat() {
    return Format && FORMAT_IDS.includes(Format.id);
  }

  // src/name_overlap.ts
  var Animation = window.Animation;
  function copyAnimationToGroupsWithSameName(animation, source_group) {
    let source_animator = animation.getBoneAnimator(source_group);
    let other_groups = Group.all.filter((g) => g.name == source_group.name && g != source_group);
    for (let group2 of other_groups) {
      let animator2 = animation.getBoneAnimator(group2);
      for (let channel in animator2.channels) {
        if (animator2[channel] instanceof Array) animator2[channel].empty();
      }
      source_animator.keyframes.forEach((kf) => {
        animator2.addKeyframe(kf, guid());
      });
    }
  }
  function setupNameOverlap() {
    Blockbench.on("finish_edit", (arg) => {
      if (arg.aspects.keyframes && Animation.selected) {
        let changes = false;
        let groups = {};
        if (Timeline.selected_animator) {
          groups[Timeline.selected_animator.name] = [
            Timeline.selected_animator.group
          ];
        }
        for (let group of Group.all) {
          if (!groups[group.name]) groups[group.name] = [];
          groups[group.name].push(group);
        }
        for (let name in groups) {
          if (groups[name].length >= 2) {
            copyAnimationToGroupsWithSameName(Animation.selected, groups[name][0]);
            if (!changes && groups[name].find((g) => g.selected)) changes = true;
          }
        }
        if (changes) {
          Animator.preview();
        }
      }
    });
    let bone_animator_select_original = BoneAnimator.prototype.select;
    BoneAnimator.prototype.select = function select(group_is_selected) {
      if (!this.getGroup()) {
        unselectAllElements();
        return this;
      }
      if (this.group.locked) return;
      for (var key in this.animation.animators) {
        this.animation.animators[key].selected = false;
      }
      if (group_is_selected !== true && this.group) {
        this.group.select();
      }
      GeneralAnimator.prototype.select.call(this);
      if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this) && !Blockbench.hasFlag("loading_selection_save")) {
        var nearest;
        this[Toolbox.selected.animation_channel].forEach((kf) => {
          if (Math.abs(kf.time - Timeline.time) < 2e-3) {
            nearest = kf;
          }
        });
        if (nearest) {
          nearest.select();
        }
      }
      if (this.group && this.group.parent && this.group.parent !== "root") {
        this.group.parent.openUp();
      }
      return this;
    };
    track({
      delete() {
        BoneAnimator.prototype.select = bone_animator_select_original;
      }
    });
    let setting = new Setting("hytale_duplicate_bone_names", {
      name: "Duplicate Bone Names",
      description: "Allow creating duplicate groups names in Hytale formats. Multiple groups with the same name can be used to apply animations to multiple nodes at once.",
      type: "toggle",
      value: false
    });
    let override = Group.addBehaviorOverride({
      condition: () => isHytaleFormat() && setting.value == true,
      // @ts-ignore
      priority: 2,
      behavior: {
        unique_name: false
      }
    });
    track(override, setting);
  }

  // src/blockyanim.ts
  var FPS = 60;
  var Animation2 = window.Animation;
  function parseAnimationFile(file, content) {
    let animation = new Animation2({
      name: pathToName(file.name, false),
      length: content.duration / FPS,
      loop: content.holdLastKeyframe ? "hold" : "loop",
      path: file.path,
      snapping: FPS
    });
    let quaternion = new THREE.Quaternion();
    let euler = new THREE.Euler(0, 0, 0, "ZYX");
    for (let name in content.nodeAnimations) {
      let anim_data = content.nodeAnimations[name];
      let group_name = name;
      let group = Group.all.find((g) => g.name == group_name);
      let uuid = group ? group.uuid : guid();
      let ba = new BoneAnimator(uuid, animation, group_name);
      animation.animators[uuid] = ba;
      const anim_channels = [
        { channel: "rotation", keyframes: anim_data.orientation },
        { channel: "position", keyframes: anim_data.position },
        { channel: "scale", keyframes: anim_data.shapeStretch },
        { channel: "visibility", keyframes: anim_data.shapeVisible }
      ];
      for (let { channel, keyframes } of anim_channels) {
        if (!keyframes || keyframes.length == 0) continue;
        for (let kf_data of keyframes) {
          let data_point;
          if (channel == "visibility") {
            data_point = {
              visibility: kf_data.delta
            };
          } else {
            let delta = kf_data.delta;
            if (channel == "rotation") {
              quaternion.set(delta.x, delta.y, delta.z, delta.w);
              euler.setFromQuaternion(quaternion.normalize(), "ZYX");
              data_point = {
                x: Math.radToDeg(euler.x),
                y: Math.radToDeg(euler.y),
                z: Math.radToDeg(euler.z)
              };
            } else {
              data_point = {
                x: delta.x,
                y: delta.y,
                z: delta.z
              };
            }
          }
          ba.addKeyframe({
            time: kf_data.time / FPS,
            channel,
            interpolation: kf_data.interpolationType == "smooth" ? "catmullrom" : "linear",
            data_points: [data_point]
          });
        }
      }
      if (group) copyAnimationToGroupsWithSameName(animation, group);
    }
    animation.add(false);
    if (!Animation2.selected && Animator.open) {
      animation.select();
    }
  }
  function compileAnimationFile(animation) {
    const nodeAnimations = {};
    const file = {
      formatVersion: 1,
      duration: animation.length * FPS,
      holdLastKeyframe: animation.loop == "hold",
      nodeAnimations
    };
    const channels = {
      position: "position",
      rotation: "orientation",
      scale: "shapeStretch",
      visibility: "shapeVisible"
    };
    for (let uuid in animation.animators) {
      let animator = animation.animators[uuid];
      if (!animator.group) continue;
      let name = animator.name;
      let node_data = {};
      let has_data = false;
      for (let channel in channels) {
        let timeline;
        let hytale_channel_key = channels[channel];
        timeline = timeline = node_data[hytale_channel_key] = [];
        let keyframe_list = animator[channel].slice();
        keyframe_list.sort((a, b) => a.time - b.time);
        for (let kf of keyframe_list) {
          let data_point = kf.data_points[0];
          let delta;
          if (channel == "visibility") {
            delta = data_point.visibility;
          } else {
            delta = {
              x: parseFloat(data_point.x),
              y: parseFloat(data_point.y),
              z: parseFloat(data_point.z)
            };
            if (channel == "rotation") {
              let euler = new THREE.Euler(
                Math.degToRad(kf.calc("x")),
                Math.degToRad(kf.calc("y")),
                Math.degToRad(kf.calc("z")),
                Format.euler_order
              );
              let quaternion = new THREE.Quaternion().setFromEuler(euler);
              delta = {
                x: quaternion.x,
                y: quaternion.y,
                z: quaternion.z,
                w: quaternion.w
              };
            }
            delta = new oneLiner(delta);
          }
          let kf_output = {
            time: Math.round(kf.time * FPS),
            delta,
            interpolationType: kf.interpolation == "catmullrom" ? "smooth" : "linear"
          };
          timeline.push(kf_output);
          has_data = true;
        }
      }
      if (has_data) {
        node_data.shapeUvOffset = [];
        nodeAnimations[name] = node_data;
      }
    }
    return file;
  }
  function setupAnimationCodec() {
    BarItems.load_animation_file.click = function(...args) {
      if (FORMAT_IDS.includes(Format.id)) {
        Filesystem.importFile({
          resource_id: "blockyanim",
          extensions: ["blockyanim"],
          type: "Blockyanim",
          multiple: true
        }, async function(files) {
          for (let file of files) {
            let content = autoParseJSON(file.content);
            parseAnimationFile(file, content);
          }
        });
        return;
      } else {
        this.dispatchEvent("use");
        this.onClick(...args);
        this.dispatchEvent("used");
      }
    };
    let export_anim = new Action("export_blockyanim", {
      name: "Export Blockyanim",
      icon: "cinematic_blur",
      condition: { formats: FORMAT_IDS, selected: { animation: true } },
      click() {
        let animation;
        animation = Animation2.selected;
        let content = compileJSON(compileAnimationFile(animation), Config.json_compile_options);
        Filesystem.exportFile({
          resource_id: "blockyanim",
          type: "Blockyanim",
          extensions: ["blockyanim"],
          name: animation.name,
          content
        });
      }
    });
    track(export_anim);
    MenuBar.menus.animation.addAction(export_anim);
    Panels.animations.toolbars[0].add(export_anim, "4");
    let handler = Filesystem.addDragHandler("blockyanim", {
      extensions: ["blockyanim"],
      readtype: "text",
      condition: { modes: ["animate"] }
    }, async function(files) {
      for (let file of files) {
        let content = autoParseJSON(file.content);
        parseAnimationFile(file, content);
      }
    });
    track(handler);
    let original_save = Animation2.prototype.save;
    Animation2.prototype.save = function(...args) {
      if (!FORMAT_IDS.includes(Format.id)) {
        return original_save.call(this, ...args);
      }
      let animation;
      animation = Animation2.selected;
      let content = compileJSON(compileAnimationFile(animation), Config.json_compile_options);
      if (isApp && this.path) {
        Blockbench.writeFile(this.path, { content }, (real_path) => {
          this.saved = true;
          this.saved_name = this.name;
          this.path = real_path;
        });
      } else {
        Blockbench.export({
          resource_id: "blockyanim",
          type: "Blockyanim",
          extensions: ["blockyanim"],
          name: animation.name,
          startpath: this.path,
          content
        }, (real_path) => {
          if (isApp) this.path == real_path;
          this.saved = true;
        });
      }
      return this;
    };
    track({
      delete() {
        Animation2.prototype.save = original_save;
      }
    });
    let original_condition = BarItems.export_animation_file.condition;
    BarItems.export_animation_file.condition = () => {
      return Condition(original_condition) && !FORMAT_IDS.includes(Format.id);
    };
    track({
      delete() {
        BarItems.export_animation_file.condition = original_condition;
      }
    });
  }

  // src/animations.ts
  function setupAnimation() {
    function displayVisibility(animator) {
      let group = animator.getGroup();
      let scene_object = group.scene_object;
      if (animator.muted.visibility) {
        scene_object.visible = group.visibility;
        return;
      }
      let previous_keyframe;
      let previous_time = -Infinity;
      for (let keyframe of animator.visibility) {
        if (keyframe.time <= Timeline.time && keyframe.time > previous_time) {
          previous_keyframe = keyframe;
          previous_time = keyframe.time;
        }
      }
      if (previous_keyframe && scene_object) {
        scene_object.visible = previous_keyframe.data_points[0]?.visibility != false;
      } else if (scene_object) {
        scene_object.visible = group.visibility;
      }
    }
    BoneAnimator.addChannel("visibility", {
      name: "Visibility",
      mutable: true,
      transform: false,
      max_data_points: 1,
      condition: { formats: FORMAT_IDS },
      displayFrame(animator, multiplier) {
        displayVisibility(animator);
      }
    });
    let property = new Property(KeyframeDataPoint, "boolean", "visibility", {
      label: "Visibility",
      condition: (point) => point.keyframe.channel == "visibility",
      default: true
    });
    track(property);
    function weightedCubicBezier(t) {
      let P0 = 0, P1 = 0.05, P2 = 0.95, P3 = 1;
      let W0 = 2, W1 = 1, W2 = 2, W3 = 1;
      let b0 = (1 - t) ** 3;
      let b1 = 3 * (1 - t) ** 2 * t;
      let b2 = 3 * (1 - t) * t ** 2;
      let b3 = t ** 3;
      let w0 = b0 * W0;
      let w1 = b1 * W1;
      let w2 = b2 * W2;
      let w3 = b3 * W3;
      let numerator = w0 * P0 + w1 * P1 + w2 * P2 + w3 * P3;
      let denominator = w0 + w1 + w2 + w3;
      return numerator / denominator;
    }
    let on_interpolate = Blockbench.on("interpolate_keyframes", (arg) => {
      if (!isHytaleFormat()) return;
      if (!arg.use_quaternions || !arg.t || arg.t == 1) return;
      if (arg.keyframe_before.interpolation != "catmullrom" || arg.keyframe_after.interpolation != "catmullrom") return;
      return {
        t: weightedCubicBezier(arg.t)
      };
    });
    track(on_interpolate);
    let original_display_scale = BoneAnimator.prototype.displayScale;
    let original_show_default_pose = Animator.showDefaultPose;
    BoneAnimator.prototype.displayScale = function displayScale(array, multiplier = 1) {
      if (!array) return this;
      if (isHytaleFormat()) {
        let target_shape = getMainShape(this.group);
        if (target_shape) {
          let initial_stretch = target_shape.stretch.slice();
          target_shape.stretch.V3_set([
            initial_stretch[0] * (1 + (array[0] - 1) * multiplier),
            initial_stretch[1] * (1 + (array[1] - 1) * multiplier),
            initial_stretch[2] * (1 + (array[2] - 1) * multiplier)
          ]);
          Cube.preview_controller.updateGeometry(target_shape);
          target_shape.stretch.V3_set(initial_stretch);
        }
        return;
      }
      original_display_scale.call(this, array, multiplier);
    };
    Animator.showDefaultPose = function(reduced_updates, ...args) {
      original_show_default_pose(reduced_updates, ...args);
      if (isHytaleFormat()) {
        for (let cube of Cube.all) {
          Cube.preview_controller.updateGeometry(cube);
        }
      }
    };
    track({
      delete() {
        BoneAnimator.prototype.displayScale = original_display_scale;
        Animator.showDefaultPose = original_show_default_pose;
      }
    });
  }

  // src/element.ts
  function setupElements() {
    let property_shading_mode = new Property(Cube, "enum", "shading_mode", {
      default: "flat",
      values: ["flat", "standard", "fullbright", "reflective"],
      condition: { formats: FORMAT_IDS },
      inputs: {
        element_panel: {
          input: { label: "Shading Mode", type: "select", options: {
            flat: "Flat",
            standard: "Standard",
            fullbright: "Always Lit",
            reflective: "Reflective"
          } },
          onChange() {
          }
        }
      }
    });
    track(property_shading_mode);
    let property_double_sided = new Property(Cube, "boolean", "double_sided", {
      condition: { formats: FORMAT_IDS },
      inputs: {
        element_panel: {
          input: { label: "Double Sided", type: "checkbox" },
          onChange() {
            Canvas.updateView({ elements: Cube.all, element_aspects: { transform: true } });
          }
        }
      }
    });
    track(property_double_sided);
    let is_piece_property = new Property(Group, "boolean", "is_piece", {
      condition: { formats: FORMAT_IDS },
      inputs: {
        element_panel: {
          input: {
            label: "Attachment Piece",
            type: "checkbox",
            description: "When checked, the node will be attached to a node of the same name when displayed as an attachment in-game."
          }
        }
      }
    });
    track(is_piece_property);
    let add_quad_action = new Action("hytale_add_quad", {
      name: "Add Quad",
      icon: "highlighter_size_5",
      category: "edit",
      condition: { formats: FORMAT_IDS, modes: ["edit"] },
      click() {
        let color = Math.floor(Math.random() * markerColors.length);
        let initial = "pos_z";
        function runEdit(amended, normal) {
          Undo.initEdit({ outliner: true, elements: [], selection: true }, amended);
          let base_quad = new Cube({
            autouv: settings.autouv.value ? 1 : 0,
            color
          }).init();
          if (!base_quad.box_uv) base_quad.mapAutoUV();
          let group = getCurrentGroup();
          if (group) {
            base_quad.addTo(group);
            if (settings.inherit_parent_color.value) base_quad.color = group.color;
          }
          let texture = Texture.all.length && Format.single_texture ? Texture.getDefault().uuid : false;
          for (let face in base_quad.faces) {
            base_quad.faces[face].texture = null;
          }
          let size = [8, 8, 8];
          let positive = normal.startsWith("pos");
          switch (normal[4]) {
            case "x": {
              base_quad.faces.west.texture = positive ? null : texture;
              base_quad.faces.east.texture = positive ? texture : null;
              size[0] = 0;
              break;
            }
            case "y": {
              base_quad.faces.down.texture = positive ? null : texture;
              base_quad.faces.up.texture = positive ? texture : null;
              size[1] = 0;
              break;
            }
            case "z": {
              base_quad.faces.north.texture = positive ? null : texture;
              base_quad.faces.south.texture = positive ? texture : null;
              size[2] = 0;
              break;
            }
          }
          base_quad.extend({
            from: [-size[0] / 2, 0, -size[2] / 2],
            to: [size[0] / 2, size[1], size[2] / 2]
          });
          let fkey = Object.keys(base_quad.faces).find((fkey2) => base_quad.faces[fkey2].texture != null);
          UVEditor.getSelectedFaces(base_quad, true).replace([fkey]);
          base_quad.select();
          Canvas.updateView({ elements: [base_quad], element_aspects: { transform: true, geometry: true, faces: true } });
          Undo.finishEdit("Add quad", { outliner: true, elements: selected, selection: true });
          Vue.nextTick(function() {
            if (settings.create_rename.value) {
              base_quad.rename();
            }
          });
        }
        runEdit(false, initial);
        Undo.amendEdit({
          normal: {
            type: "inline_select",
            value: initial,
            label: "Normal",
            options: {
              "pos_x": "+X",
              "neg_x": "-X",
              "pos_y": "+Y",
              "neg_y": "-Y",
              "pos_z": "+Z",
              "neg_z": "-Z"
            }
          }
        }, (form) => {
          runEdit(true, form.normal);
        });
      }
    });
    track(add_quad_action);
    let add_element_menu = BarItems.add_element.side_menu;
    add_element_menu.addAction(add_quad_action);
    Blockbench.on("finish_edit", (arg) => {
      if (!FORMAT_IDS.includes(Format.id)) return;
      if (arg.aspects?.elements) {
        let changes = false;
        for (let element of arg.aspects.elements) {
          if (element instanceof Cube == false) continue;
          if (element.autouv) continue;
          element.autouv = 1;
          element.mapAutoUV();
          element.preview_controller.updateUV(element);
          changes = true;
        }
        if (changes) {
          UVEditor.vue.$forceUpdate();
        }
      }
    });
    let originalAutoUV = Cube.prototype.mapAutoUV;
    Cube.prototype.mapAutoUV = function(options = {}) {
      if (this.box_uv) return;
      var scope = this;
      if (scope.autouv === 2) {
        var all_faces = ["north", "south", "west", "east", "up", "down"];
        let offset = Format.centered_grid ? 8 : 0;
        all_faces.forEach(function(side) {
          var uv = scope.faces[side].uv.slice();
          let texture = scope.faces[side].getTexture();
          let uv_width = Project.getUVWidth(texture);
          let uv_height = Project.getUVWidth(texture);
          switch (side) {
            case "north":
              uv = [
                uv_width - (scope.to[0] + offset),
                uv_height - scope.to[1],
                uv_width - (scope.from[0] + offset),
                uv_height - scope.from[1]
              ];
              break;
            case "south":
              uv = [
                scope.from[0] + offset,
                uv_height - scope.to[1],
                scope.to[0] + offset,
                uv_height - scope.from[1]
              ];
              break;
            case "west":
              uv = [
                scope.from[2] + offset,
                uv_height - scope.to[1],
                scope.to[2] + offset,
                uv_height - scope.from[1]
              ];
              break;
            case "east":
              uv = [
                uv_width - (scope.to[2] + offset),
                uv_height - scope.to[1],
                uv_width - (scope.from[2] + offset),
                uv_height - scope.from[1]
              ];
              break;
            case "up":
              uv = [
                scope.from[0] + offset,
                scope.from[2] + offset,
                scope.to[0] + offset,
                scope.to[2] + offset
              ];
              break;
            case "down":
              uv = [
                scope.from[0] + offset,
                uv_height - (scope.to[2] + offset),
                scope.to[0] + offset,
                uv_height - (scope.from[2] + offset)
              ];
              break;
          }
          if (Math.max(uv[0], uv[2]) > uv_width) {
            let offset2 = Math.max(uv[0], uv[2]) - uv_width;
            uv[0] -= offset2;
            uv[2] -= offset2;
          }
          if (Math.min(uv[0], uv[2]) < 0) {
            let offset2 = Math.min(uv[0], uv[2]);
            uv[0] = Math.clamp(uv[0] - offset2, 0, uv_width);
            uv[2] = Math.clamp(uv[2] - offset2, 0, uv_width);
          }
          if (Math.max(uv[1], uv[3]) > uv_height) {
            let offset2 = Math.max(uv[1], uv[3]) - uv_height;
            uv[1] -= offset2;
            uv[3] -= offset2;
          }
          if (Math.min(uv[1], uv[3]) < 0) {
            let offset2 = Math.min(uv[1], uv[3]);
            uv[1] = Math.clamp(uv[1] - offset2, 0, uv_height);
            uv[3] = Math.clamp(uv[3] - offset2, 0, uv_height);
          }
          scope.faces[side].uv = uv;
        });
        scope.preview_controller.updateUV(scope);
      } else if (scope.autouv === 1) {
        let calcAutoUV = function(fkey, dimension_axes, world_directions) {
          let size = dimension_axes.map((axis) => scope.size(axis));
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
          if (rot === 90 || rot === 270) {
            size.reverse();
            dimension_axes.reverse();
            world_directions.reverse();
          }
          if (rot == 180) {
            world_directions[0] *= -1;
            world_directions[1] *= -1;
          }
          size[0] = Math.clamp(size[0], -uv_width, uv_width) * (Math.sign(previous_size[0]) || 1);
          size[1] = Math.clamp(size[1], -uv_height, uv_height) * (Math.sign(previous_size[1]) || 1);
          if (options && typeof options.axis == "number") {
            if (options.axis == dimension_axes[0] && options.direction == world_directions[0]) {
              sx += previous_size[0] - size[0];
            }
            if (options.axis == dimension_axes[1] && options.direction == world_directions[1]) {
              sy += previous_size[1] - size[1];
            }
          }
          if (sx < 0) sx = 0;
          if (sy < 0) sy = 0;
          let endx = sx + size[0];
          let endy = sy + size[1];
          if (endx > uv_width) {
            sx = uv_width - (endx - sx);
            endx = uv_width;
          }
          if (endy > uv_height) {
            sy = uv_height - (endy - sy);
            endy = uv_height;
          }
          return [sx, sy, endx, endy];
        };
        scope.faces.north.uv = calcAutoUV("north", [0, 1], [1, 1]);
        scope.faces.east.uv = calcAutoUV("east", [2, 1], [1, 1]);
        scope.faces.south.uv = calcAutoUV("south", [0, 1], [-1, 1]);
        scope.faces.west.uv = calcAutoUV("west", [2, 1], [-1, 1]);
        scope.faces.up.uv = calcAutoUV("up", [0, 2], [-1, -1]);
        scope.faces.down.uv = calcAutoUV("down", [0, 2], [-1, 1]);
        scope.preview_controller.updateUV(scope);
      }
    };
    track({
      delete() {
        Cube.prototype.mapAutoUV = originalAutoUV;
      }
    });
  }

  // src/uv_cycling.ts
  var cycleState = null;
  var CLICK_THRESHOLD = 0;
  function screenToUV(event) {
    return UVEditor.getBrushCoordinates(event, UVEditor.texture);
  }
  function isPointInRect(x, y, rect) {
    const minX = Math.min(rect.ax, rect.bx);
    const maxX = Math.max(rect.ax, rect.bx);
    const minY = Math.min(rect.ay, rect.by);
    const maxY = Math.max(rect.ay, rect.by);
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }
  function getFacesAtUVPosition(uvX, uvY) {
    const faces = [];
    for (const cube of Cube.all) {
      if (!cube.visibility) continue;
      for (const faceKey in cube.faces) {
        const face = cube.faces[faceKey];
        if (face.enabled === false) continue;
        const rect = face.getBoundingRect();
        if (isPointInRect(uvX, uvY, rect)) {
          faces.push({ cube, faceKey });
        }
      }
    }
    faces.sort((a, b) => {
      if (a.cube.name !== b.cube.name) {
        return a.cube.name.localeCompare(b.cube.name);
      }
      return a.faceKey.localeCompare(b.faceKey);
    });
    const currentSelectedFaces = UVEditor.selected_faces || [];
    const currentCube = Cube.selected[0];
    if (currentCube && currentSelectedFaces.length > 0) {
      const currentFaceKey = currentSelectedFaces[0];
      const currentIndex = faces.findIndex(
        (f) => f.cube.uuid === currentCube.uuid && f.faceKey === currentFaceKey
      );
      if (currentIndex > 0) {
        return [...faces.slice(currentIndex), ...faces.slice(0, currentIndex)];
      }
    }
    return faces;
  }
  function selectFace(cube, faceKey) {
    cube.select();
    UVEditor.getSelectedFaces(cube, true).replace([faceKey]);
    UVEditor.vue.$forceUpdate();
    Canvas.updateView({
      elements: [cube],
      element_aspects: { faces: true }
    });
  }
  function setupUVCycling() {
    const uvPanel = Panels.uv;
    if (!uvPanel) return;
    function initializeClickHandler() {
      const uv_viewport = uvPanel.node?.querySelector("#uv_viewport");
      if (!uv_viewport) return false;
      let pendingClick = null;
      function handleMouseDown(event) {
        if (!FORMAT_IDS.includes(Format.id)) return;
        if (Modes.paint) return;
        if (event.button !== 0) return;
        pendingClick = { uvPos: screenToUV(event) };
      }
      function handleMouseUp(event) {
        if (!pendingClick) return;
        if (event.button !== 0) return;
        const uvPos = screenToUV(event);
        pendingClick = null;
        const isSamePosition = cycleState !== null && Math.abs(uvPos.x - cycleState.lastClickX) <= CLICK_THRESHOLD && Math.abs(uvPos.y - cycleState.lastClickY) <= CLICK_THRESHOLD;
        if (isSamePosition && cycleState) {
          cycleState.currentIndex = (cycleState.currentIndex + 1) % cycleState.facesAtPosition.length;
          const { cube, faceKey } = cycleState.facesAtPosition[cycleState.currentIndex];
          setTimeout(() => selectFace(cube, faceKey), 50);
        } else {
          const faces = getFacesAtUVPosition(uvPos.x, uvPos.y);
          if (faces.length > 1) {
            cycleState = {
              lastClickX: uvPos.x,
              lastClickY: uvPos.y,
              currentIndex: 0,
              facesAtPosition: faces
            };
          } else {
            cycleState = null;
          }
        }
      }
      uv_viewport.addEventListener("mousedown", handleMouseDown);
      uv_viewport.addEventListener("mouseup", handleMouseUp);
      track({
        delete() {
          uv_viewport.removeEventListener("mousedown", handleMouseDown);
          uv_viewport.removeEventListener("mouseup", handleMouseUp);
        }
      });
      return true;
    }
    if (uvPanel.node && initializeClickHandler()) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (uvPanel.node && initializeClickHandler()) {
        clearInterval(interval);
      } else if (attempts >= 50) {
        clearInterval(interval);
      }
    }, 100);
    track({ delete() {
      clearInterval(interval);
    } });
  }

  // src/validation.ts
  var MAX_NODE_COUNT = 255;
  function getNodeCount() {
    let node_count = 0;
    for (let group of Group.all) {
      if (group.export == false) return;
      if (Collection.all.find((c) => c.contains(group))) continue;
      node_count++;
      let main_shape = getMainShape(group);
      for (let cube of group.children) {
        if (cube instanceof Cube == false || cube.export == false) continue;
        if (cube == main_shape) continue;
        node_count++;
      }
    }
    return node_count;
  }
  function setupChecks() {
    let check = new ValidatorCheck("hytale_node_count", {
      update_triggers: ["update_selection"],
      condition: { formats: FORMAT_IDS },
      run() {
        let node_count = getNodeCount();
        if (node_count > MAX_NODE_COUNT) {
          this.fail({
            message: `The model contains ${node_count} nodes, which exceeds the maximum of ${MAX_NODE_COUNT} that Hytale will display.`
          });
        }
      }
    });
    track(check);
    let listener = Blockbench.on("display_model_stats", ({ stats }) => {
      if (!FORMAT_IDS.includes(Format.id)) return;
      let node_count = getNodeCount();
      stats.splice(0, 0, { label: "Nodes", value: node_count + " / " + MAX_NODE_COUNT });
    });
    track(listener);
  }

  // package.json
  var package_default = {
    name: "hytale-blockbench-plugin",
    version: "0.3.2",
    description: "Create models and animations for Hytale",
    main: "src/plugin.ts",
    type: "module",
    scripts: {
      build: "esbuild src/plugin.ts --bundle --outfile=dist/hytale_plugin.js",
      dev: "esbuild src/plugin.ts --bundle --outfile=dist/hytale_plugin.js --watch"
    },
    author: "JannisX11, Kanno",
    license: "MIT",
    dependencies: {
      "blockbench-types": "^5.0.5"
    },
    devDependencies: {
      esbuild: "^0.25.9"
    }
  };

  // src/photoshop_copy_paste.ts
  function setupPhotoshopTools() {
    let setting = new Setting("copy_paste_magenta_alpha", {
      name: "Copy-Paste with Magenta Alpha",
      description: "Copy image selections with magenta background and remove magenta when pasting to help transfer transparency to Photoshop",
      type: "toggle",
      value: false
    });
    track(setting);
    let shared_copy = SharedActions.add("copy", {
      subject: "image_content_photoshop",
      condition: () => Prop.active_panel == "uv" && Modes.paint && Texture.getDefault() && FORMAT_IDS.includes(Format.id) && setting.value == true,
      priority: 2,
      run(event, cut) {
        let texture = Texture.getDefault();
        let selection = texture.selection;
        let { canvas, ctx, offset } = texture.getActiveCanvas();
        if (selection.override != null) {
          Clipbench.image = {
            x: offset[0],
            y: offset[1],
            frame: texture.currentFrame,
            data: ""
          };
        } else {
          let rect = selection.getBoundingRect();
          let copy_canvas = document.createElement("canvas");
          let copy_ctx = copy_canvas.getContext("2d");
          copy_canvas.width = rect.width;
          copy_canvas.height = rect.height;
          selection.maskCanvas(copy_ctx, [rect.start_x, rect.start_y]);
          copy_ctx.drawImage(canvas, -rect.start_x + offset[0], -rect.start_y + offset[1]);
          Clipbench.image = {
            x: rect.start_x,
            y: rect.start_y,
            frame: texture.currentFrame,
            data: ""
          };
          canvas = copy_canvas;
        }
        let canvas_copy_magenta = document.createElement("canvas");
        let copy_ctx_magenta = canvas_copy_magenta.getContext("2d");
        canvas_copy_magenta.width = canvas.width;
        canvas_copy_magenta.height = canvas.height;
        copy_ctx_magenta.fillStyle = "#ff00ff";
        copy_ctx_magenta.fillRect(0, 0, canvas.width, canvas.height);
        copy_ctx_magenta.drawImage(canvas, 0, 0);
        canvas = canvas_copy_magenta;
        Clipbench.image.data = canvas.toDataURL("image/png", 1);
        if (isApp) {
          let clipboard = requireNativeModule("clipboard");
          let img = nativeImage.createFromDataURL(Clipbench.image.data);
          clipboard.writeImage(img);
        } else {
          canvas.toBlob((blob) => {
            navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob
              })
            ]);
          });
        }
        if (cut) {
          SharedActions.runSpecific("delete", "image_content", event, { message: "Cut texture selection" });
        }
      }
    });
    track(shared_copy);
    let shared_paste = SharedActions.add("paste", {
      subject: "image_content_photoshop",
      condition: () => Prop.active_panel == "uv" && Modes.paint && Texture.getDefault() && FORMAT_IDS.includes(Format.id) && setting.value == true,
      priority: 2,
      run(event) {
        let texture = Texture.getDefault();
        async function loadFromDataUrl(data_url) {
          let frame = new CanvasFrame();
          await frame.loadFromURL(data_url);
          Undo.initEdit({ textures: [texture], bitmap: true });
          if (!texture.layers_enabled) {
            texture.flags.add("temporary_layers");
            texture.activateLayers(false);
          }
          let offset;
          if (Clipbench.image) {
            offset = [Math.clamp(Clipbench.image.x, 0, texture.width), Math.clamp(Clipbench.image.y, 0, texture.height)];
            offset[0] = Math.clamp(offset[0], 0, texture.width - frame.width);
            offset[1] = Math.clamp(offset[1], 0, texture.height - frame.height);
          }
          let old_frame = Clipbench.image?.frame || 0;
          if (old_frame || texture.currentFrame) {
            offset[1] += texture.display_height * ((texture.currentFrame || 0) - old_frame);
          }
          let layer = new TextureLayer({ name: "pasted", offset }, texture);
          let image_data = frame.ctx.getImageData(0, 0, frame.width, frame.height);
          for (let i = 0; i < image_data.data.length; i += 4) {
            if (image_data.data[i] == 255 && image_data.data[i + 1] == 0 && image_data.data[i + 2] == 255) {
              image_data.data[i + 0] = 0;
              image_data.data[i + 1] = 0;
              image_data.data[i + 2] = 0;
              image_data.data[i + 3] = 0;
            }
          }
          layer.setSize(frame.width, frame.height);
          layer.ctx.putImageData(image_data, 0, 0);
          if (!offset) layer.center();
          layer.addForEditing();
          layer.setLimbo();
          texture.updateChangesAfterEdit();
          Undo.finishEdit("Paste into texture");
          if (Toolbox.selected.id != "selection_tool") BarItems.move_layer_tool.select();
          updateInterfacePanels();
          BARS.updateConditions();
        }
        if (isApp) {
          let clipboard = requireNativeModule("clipboard");
          var image = clipboard.readImage().toDataURL();
          loadFromDataUrl(image);
        } else {
          navigator.clipboard.read().then((content) => {
            if (content && content[0] && content[0].types.includes("image/png")) {
              content[0].getType("image/png").then((blob) => {
                let url = URL.createObjectURL(blob);
                loadFromDataUrl(url);
              });
            }
          }).catch(() => {
          });
        }
      }
    });
    track(shared_paste);
  }

  // src/pivot_marker.ts
  var ThickLineAxisHelper = class ThickLineAxisHelper2 extends THREE.LineSegments {
    constructor(size = 1) {
      let a = 0.04, b = 0.025;
      let vertices = [
        0,
        a,
        0,
        size,
        a,
        0,
        0,
        0,
        b,
        size,
        0,
        b,
        0,
        0,
        -b,
        size,
        0,
        -b,
        0,
        0,
        a,
        0,
        size,
        a,
        b,
        0,
        0,
        b,
        size,
        0,
        -b,
        0,
        0,
        -b,
        size,
        0,
        a,
        0,
        0,
        a,
        0,
        size,
        0,
        b,
        0,
        0,
        b,
        size,
        0,
        -b,
        0,
        0,
        -b,
        size
      ];
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      let material = new THREE.LineBasicMaterial({ vertexColors: true });
      super(geometry, material);
      this.updateColors();
      material.transparent = true;
      material.depthTest = false;
      this.renderOrder = 800;
    }
    updateColors() {
      let colors = [
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.r.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.g.toArray(),
        ...gizmo_colors.b.toArray(),
        ...gizmo_colors.b.toArray(),
        ...gizmo_colors.b.toArray(),
        ...gizmo_colors.b.toArray(),
        ...gizmo_colors.b.toArray(),
        ...gizmo_colors.b.toArray()
      ];
      this.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
  };
  ThickLineAxisHelper.prototype.constructor = ThickLineAxisHelper;
  var CustomPivotMarker = class {
    original_helpers;
    constructor() {
      this.original_helpers = Canvas.pivot_marker.children.slice();
      let [helper1, helper2] = this.original_helpers;
      let helper1_new = new ThickLineAxisHelper(1);
      let helper2_new = new ThickLineAxisHelper(1);
      helper1_new.rotation.copy(helper1.rotation);
      helper2_new.rotation.copy(helper2.rotation);
      Canvas.pivot_marker.children.empty();
      Canvas.pivot_marker.add(helper1_new, helper2_new);
    }
    delete() {
      Canvas.pivot_marker.children.empty();
      Canvas.pivot_marker.add(...this.original_helpers);
    }
  };
  var GroupPivotIndicator = class {
    dot;
    listener;
    cameraListener;
    setting;
    constructor() {
      this.setting = new Setting("show_group_pivot_indicator", {
        name: "Show Group Pivot Indicator",
        description: "Show a dot in Edit mode indicating the rotation pivot point for animations",
        category: "preview",
        type: "toggle",
        value: true
      });
      let geometry = new THREE.SphereGeometry(0.65, 12, 12);
      let material = new THREE.MeshBasicMaterial({
        color: this.getAccentColor(),
        transparent: true,
        opacity: 0.9,
        depthTest: false
      });
      this.dot = new THREE.Mesh(geometry, material);
      this.dot.renderOrder = 900;
      this.dot.visible = false;
      Canvas.scene.add(this.dot);
      this.listener = Blockbench.on("update_selection", () => this.update());
      this.cameraListener = Blockbench.on("update_camera_position", () => this.updateScale());
      this.update();
    }
    updateScale() {
      if (!this.dot.visible) return;
      let scale = Preview.selected.calculateControlScale(this.dot.position) || 0.8;
      this.dot.scale.setScalar(scale * 0.7);
    }
    getAccentColor() {
      let cssColor = getComputedStyle(document.body).getPropertyValue("--color-accent").trim();
      return new THREE.Color(cssColor || "#3e90ff");
    }
    update() {
      if (!this.setting.value) {
        this.dot.visible = false;
        return;
      }
      let group = this.getRelevantGroup();
      if (!group) {
        this.dot.visible = false;
        return;
      }
      this.dot.material.color.copy(this.getAccentColor());
      let mesh = group.mesh;
      if (mesh) {
        let worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        this.dot.position.copy(worldPos);
        this.dot.visible = true;
        this.updateScale();
      } else {
        this.dot.visible = false;
      }
    }
    getRelevantGroup() {
      let sel = Outliner.selected[0];
      if (!sel) return null;
      if (sel instanceof Group) {
        return sel;
      }
      if (sel.parent instanceof Group) {
        return sel.parent;
      }
      return null;
    }
    delete() {
      Canvas.scene.remove(this.dot);
      this.dot.geometry.dispose();
      this.dot.material.dispose();
      this.listener.delete();
      this.cameraListener.delete();
      this.setting.delete();
    }
  };

  // src/outliner_filter.ts
  var HIDDEN_CLASS = "hytale_attachment_hidden";
  var attachmentsHidden = false;
  function getAttachmentUUIDs() {
    let uuids = [];
    if (!Collection.all?.length) return uuids;
    for (let collection of Collection.all) {
      for (let child of collection.getChildren()) {
        uuids.push(child.uuid);
        if ("children" in child && Array.isArray(child.children)) {
          collectChildUUIDs(child, uuids);
        }
      }
    }
    return uuids;
  }
  function collectChildUUIDs(parent, uuids) {
    for (let child of parent.children) {
      if (child instanceof OutlinerNode) {
        uuids.push(child.uuid);
        if ("children" in child && Array.isArray(child.children)) {
          collectChildUUIDs(child, uuids);
        }
      }
    }
  }
  function applyOutlinerVisibility() {
    const outlinerNode = Panels.outliner?.node;
    if (!outlinerNode) return;
    if (!attachmentsHidden) {
      outlinerNode.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
        el.classList.remove(HIDDEN_CLASS);
      });
      for (let collection of Collection.all ?? []) {
        for (let child of collection.getChildren()) {
          unlockRecursive(child);
        }
      }
      return;
    }
    const uuids = getAttachmentUUIDs();
    for (let uuid of uuids) {
      let node = outlinerNode.querySelector(`[id="${uuid}"]`);
      if (node) {
        node.classList.add(HIDDEN_CLASS);
      }
      let element = OutlinerNode.uuids[uuid];
      if (element) {
        element.locked = true;
      }
    }
  }
  function unlockRecursive(node) {
    node.locked = false;
    if ("children" in node && Array.isArray(node.children)) {
      for (let child of node.children) {
        if (child instanceof OutlinerNode) {
          unlockRecursive(child);
        }
      }
    }
  }
  function setupOutlinerFilter() {
    let style = document.createElement("style");
    style.id = "hytale-outliner-filter-styles";
    style.textContent = `
		.outliner_node.${HIDDEN_CLASS} {
			display: none !important;
		}
	`;
    document.head.appendChild(style);
    StateMemory.init("hytale_attachments_hidden", "boolean");
    attachmentsHidden = StateMemory.get("hytale_attachments_hidden") ?? false;
    let toggle = new Toggle("toggle_attachments_in_outliner", {
      name: "Toggle Attachments",
      description: "Show or hide attachments in the outliner",
      icon: "fa-paperclip",
      category: "view",
      condition: { formats: FORMAT_IDS },
      default: attachmentsHidden,
      onChange(value) {
        attachmentsHidden = value;
        StateMemory.set("hytale_attachments_hidden", value);
        applyOutlinerVisibility();
      }
    });
    let outlinerPanel = Panels.outliner;
    if (outlinerPanel && outlinerPanel.toolbars.length > 0) {
      outlinerPanel.toolbars[0].add(toggle, -1);
    }
    let hookFinishedEdit = Blockbench.on("finished_edit", () => {
      if (attachmentsHidden) {
        setTimeout(applyOutlinerVisibility, 10);
      }
    });
    let hookSelectMode = Blockbench.on("select_mode", () => {
      if (attachmentsHidden) {
        setTimeout(applyOutlinerVisibility, 50);
      }
    });
    let hookSelection = Blockbench.on("update_selection", () => {
      if (attachmentsHidden) {
        setTimeout(applyOutlinerVisibility, 10);
      }
    });
    if (attachmentsHidden) {
      setTimeout(applyOutlinerVisibility, 100);
    }
    track(toggle, hookFinishedEdit, hookSelectMode, hookSelection, {
      delete() {
        style.remove();
        Panels.outliner?.node?.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => {
          el.classList.remove(HIDDEN_CLASS);
        });
      }
    });
  }

  // src/texture.ts
  function setupTextureHandling() {
    let setting = new Setting("preview_selected_texture", {
      name: "Preview Selected Texture",
      description: "When selecting a texture in a Hytale format, preview the texture on the model instantly",
      category: "preview",
      type: "toggle",
      value: true
    });
    track(setting);
    let handler = Blockbench.on("select_texture", (arg) => {
      if (!isHytaleFormat()) return;
      if (setting.value == false) return;
      let texture = arg.texture;
      let texture_group = texture.getGroup();
      if (!texture_group) {
        texture.setAsDefaultTexture();
      }
    });
    track(handler);
  }

  // src/alt_duplicate.ts
  function setupAltDuplicate() {
    const action = new Action("hytale_duplicate_drag_modifier", {
      name: "Duplicate While Dragging",
      icon: "content_copy",
      category: "edit",
      condition: { formats: FORMAT_IDS, modes: ["edit"] },
      keybind: new Keybind({ key: 18 }),
      click: () => Blockbench.showQuickMessage("Hold this key while dragging the gizmo to duplicate")
    });
    track(action);
    let isDragging = false;
    let modifierWasPressed = false;
    let justDuplicated = false;
    function isModifierPressed(event) {
      const kb = action.keybind;
      if (kb.key === 18 || kb.alt) return event.altKey;
      if (kb.key === 17 || kb.ctrl) return event.ctrlKey;
      if (kb.key === 16 || kb.shift) return event.shiftKey;
      return Pressing.alt;
    }
    function isModifierKey(event) {
      const kb = action.keybind;
      return event.keyCode === kb.key || event.key === "Alt" && (kb.key === 18 || kb.alt) || event.key === "Control" && (kb.key === 17 || kb.ctrl) || event.key === "Shift" && (kb.key === 16 || kb.shift);
    }
    function hasSelectedAncestor(node, selectedGroupUuids) {
      let current = node.parent;
      while (current && current !== "root") {
        if (current instanceof Group && selectedGroupUuids.has(current.uuid)) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }
    function duplicateElement(element) {
      const copy = element.getSaveCopy?.(true);
      if (!copy) return null;
      const newElement = OutlinerElement.fromSave(copy, false);
      if (!newElement) return null;
      newElement.init();
      if (element.parent && element.parent !== "root") {
        newElement.addTo(element.parent);
      }
      return newElement;
    }
    function performDuplication() {
      const selectedGroups = Group.all.filter((g) => g.selected);
      const selectedElements = [...selected];
      if (selectedElements.length === 0 && selectedGroups.length === 0) return false;
      const selectedGroupUuids = new Set(selectedGroups.map((g) => g.uuid));
      const groupsToDuplicate = selectedGroups.filter((g) => !hasSelectedAncestor(g, selectedGroupUuids));
      const elementsToDuplicate = selectedElements.filter((el) => !hasSelectedAncestor(el, selectedGroupUuids));
      if (groupsToDuplicate.length === 0 && elementsToDuplicate.length === 0) return false;
      Undo.initEdit({ outliner: true, elements: selectedElements, selection: true });
      const newGroups = [];
      const newElements = [];
      for (const group of groupsToDuplicate) {
        const dup = group.duplicate();
        newGroups.push(dup);
        dup.forEachChild((child) => {
          if (child instanceof OutlinerElement) newElements.push(child);
        }, OutlinerElement, true);
      }
      for (const element of elementsToDuplicate) {
        const dup = duplicateElement(element);
        if (dup) newElements.push(dup);
      }
      unselectAllElements();
      Group.all.forEach((g) => g.selected && (g.selected = false));
      newGroups.forEach((g, i) => g.select(i > 0 ? { shiftKey: true } : void 0));
      newElements.filter((el) => !newGroups.some((g) => g.contains(el))).forEach((el) => el.select({ shiftKey: true }, true));
      Canvas.updateView({
        elements: newElements,
        element_aspects: { transform: true, geometry: true },
        selection: true
      });
      Undo.finishEdit("Alt + Drag Duplicate", {
        outliner: true,
        elements: newElements,
        selection: true
      });
      return true;
    }
    function onMouseDown(event) {
      if (justDuplicated) {
        justDuplicated = false;
        return;
      }
      const axis = Transformer?.axis;
      const hasSelection = selected.length > 0 || Group.all.some((g) => g.selected);
      if (axis && hasSelection && isModifierPressed(event)) {
        event.stopImmediatePropagation();
        modifierWasPressed = true;
        if (performDuplication()) {
          justDuplicated = true;
          setTimeout(() => {
            event.target?.dispatchEvent(new MouseEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button,
              buttons: event.buttons,
              view: window
            }));
            isDragging = true;
          }, 0);
        }
      } else if (axis && hasSelection) {
        isDragging = true;
      }
    }
    function onKeyDown(event) {
      if (isModifierKey(event) && isDragging && !modifierWasPressed) {
        modifierWasPressed = true;
        performDuplication();
      }
    }
    function onKeyUp(event) {
      if (isModifierKey(event)) modifierWasPressed = false;
    }
    function onMouseUp() {
      if (isDragging) {
        isDragging = false;
        modifierWasPressed = false;
      }
    }
    const events = [
      ["pointerdown", onMouseDown],
      ["mousedown", onMouseDown],
      ["pointerup", onMouseUp],
      ["mouseup", onMouseUp],
      ["keydown", onKeyDown],
      ["keyup", onKeyUp]
    ];
    events.forEach(([type, handler]) => document.addEventListener(type, handler, true));
    track({
      delete: () => events.forEach(([type, handler]) => document.removeEventListener(type, handler, true))
    });
  }

  // src/uv_fill.ts
  function setupUVFill() {
    const fillModeSelect = BarItems.fill_mode;
    fillModeSelect.options["uv"] = { name: "UV" };
    const originalUseFilltool = Painter.useFilltool;
    Painter.useFilltool = function(texture, ctx, x, y, area) {
      if (fillModeSelect.get() !== "uv") {
        return originalUseFilltool.call(Painter, texture, ctx, x, y, area);
      }
      uvRegionFill(texture, ctx, x, y, area);
    };
    track({
      delete() {
        Painter.useFilltool = originalUseFilltool;
        delete fillModeSelect.options["uv"];
      }
    });
  }
  function uvRegionFill(texture, ctx, x, y, area) {
    const region = findFaceRegion(texture, x, y, area.uvFactorX, area.uvFactorY);
    if (!region) return;
    const clickedAlpha = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    if (clickedAlpha === 0) {
      fillTransparent(ctx, region);
    } else if (isFlatColor(ctx, region)) {
      fillRegion(ctx, region);
    }
  }
  function findFaceRegion(texture, x, y, uvFactorX, uvFactorY) {
    const animOffset = texture.display_height * texture.currentFrame;
    for (const cube of Cube.all) {
      for (const faceKey in cube.faces) {
        const face = cube.faces[faceKey];
        const faceTexture = face.getTexture();
        if (!faceTexture || Painter.getTextureToEdit(faceTexture) !== texture) continue;
        const uv = face.uv;
        if (!uv) continue;
        const minX = Math.floor(Math.min(uv[0], uv[2]) * uvFactorX);
        const maxX = Math.ceil(Math.max(uv[0], uv[2]) * uvFactorX);
        const minY = Math.floor(Math.min(uv[1], uv[3]) * uvFactorY) + animOffset;
        const maxY = Math.ceil(Math.max(uv[1], uv[3]) * uvFactorY) + animOffset;
        if (x >= minX && x < maxX && y >= minY && y < maxY) {
          return { minX, minY, maxX, maxY };
        }
      }
    }
    for (const mesh of Mesh.all) {
      for (const faceKey in mesh.faces) {
        const face = mesh.faces[faceKey];
        const faceTexture = face.getTexture();
        if (!faceTexture || Painter.getTextureToEdit(faceTexture) !== texture) continue;
        if (face.vertices.length < 3) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const vkey in face.uv) {
          const uv = face.uv[vkey];
          minX = Math.min(minX, uv[0] * uvFactorX);
          maxX = Math.max(maxX, uv[0] * uvFactorX);
          minY = Math.min(minY, uv[1] * uvFactorY);
          maxY = Math.max(maxY, uv[1] * uvFactorY);
        }
        minX = Math.floor(minX);
        minY = Math.floor(minY) + animOffset;
        maxX = Math.ceil(maxX);
        maxY = Math.ceil(maxY) + animOffset;
        if (x >= minX && x < maxX && y >= minY && y < maxY) {
          return { minX, minY, maxX, maxY };
        }
      }
    }
    return null;
  }
  function isFlatColor(ctx, region) {
    const width = region.maxX - region.minX;
    const height = region.maxY - region.minY;
    if (width <= 0 || height <= 0) return false;
    const data = ctx.getImageData(region.minX, region.minY, width, height).data;
    const [r, g, b, a] = [data[0], data[1], data[2], data[3]];
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== a) {
        return false;
      }
    }
    return true;
  }
  function fillRegion(ctx, region) {
    const opacity = BarItems.slider_brush_opacity.get() / 255;
    ctx.save();
    ctx.fillStyle = tinycolor(ColorPanel.get()).setAlpha(opacity).toRgbString();
    ctx.fillRect(region.minX, region.minY, region.maxX - region.minX, region.maxY - region.minY);
    ctx.restore();
  }
  function fillTransparent(ctx, region) {
    const width = region.maxX - region.minX;
    const height = region.maxY - region.minY;
    if (width <= 0 || height <= 0) return;
    const imageData = ctx.getImageData(region.minX, region.minY, width, height);
    const data = imageData.data;
    const color = tinycolor(ColorPanel.get()).toRgb();
    const alpha = Math.round(BarItems.slider_brush_opacity.get() / 255 * 255);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) {
        data[i] = color.r;
        data[i + 1] = color.g;
        data[i + 2] = color.b;
        data[i + 3] = alpha;
      }
    }
    ctx.putImageData(imageData, region.minX, region.minY);
  }

  // src/uv_outline.ts
  var UV_OUTLINE_CSS = `
body.hytale-format #uv_frame .uv_resize_corner,
body.hytale-format #uv_frame .uv_resize_side,
body.hytale-format #uv_frame #uv_scale_handle,
body.hytale-format #uv_frame #uv_selection_frame {
    display: none;
}

body.hytale-format #uv_frame.overlay_mode {
    --uv-line-width: 2px;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face {
    border-color: transparent !important;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    bottom: -1px;
    border: 1px solid var(--color-text);
    pointer-events: none;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face.selected:not(.unselected) {
    outline: none;
}

body.hytale-uv-outline-only #uv_frame {
    --color-uv-background: transparent;
    --color-uv-background-hover: transparent;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face {
    border-color: transparent !important;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    bottom: -1px;
    border: 1px solid var(--color-text);
    pointer-events: none;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face:hover::before {
    border-color: var(--color-accent);
}
body.hytale-uv-outline-only #uv_frame:not(.overlay_mode) .cube_uv_face.selected:not(.unselected)::before {
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    border-width: 2px;
    border-color: var(--color-accent);
}
body.hytale-uv-outline-only #uv_frame .mesh_uv_face polygon {
    stroke-width: 1px;
}
body.hytale-uv-outline-only #uv_frame:not(.overlay_mode) .mesh_uv_face.selected polygon {
    stroke-width: 2px;
}
body.hytale-uv-outline-only #uv_frame .selection_rectangle {
    background-color: transparent;
}
`;
  function updateHytaleFormatClass() {
    document.body.classList.toggle("hytale-format", isHytaleFormat());
  }
  function setupUVOutline() {
    const style = Blockbench.addCSS(UV_OUTLINE_CSS);
    track(style);
    const setting = new Setting("uv_outline_only", {
      name: "UV Outline Only",
      description: "Show only outlines for UV faces instead of filled overlays",
      category: "edit",
      value: true,
      onChange(value) {
        document.body.classList.toggle("hytale-uv-outline-only", value);
      }
    });
    track(setting);
    const selectProjectListener = Blockbench.on("select_project", updateHytaleFormatClass);
    track(selectProjectListener);
    document.body.classList.toggle("hytale-uv-outline-only", settings.uv_outline_only?.value ?? true);
    updateHytaleFormatClass();
  }

  // src/plugin.ts
  BBPlugin.register("hytale_plugin", {
    title: "Hytale Models",
    author: "JannisX11, Kanno",
    icon: "icon.png",
    version: package_default.version,
    description: "Create models and animations for Hytale",
    tags: ["Hytale"],
    variant: "both",
    min_version: "5.0.5",
    await_loading: true,
    has_changelog: true,
    repository: "https://github.com/JannisX11/hytale-blockbench-plugin",
    bug_tracker: "https://github.com/JannisX11/hytale-blockbench-plugin/issues",
    onload() {
      setupFormats();
      setupElements();
      setupAnimation();
      setupAnimationCodec();
      setupAttachments();
      setupOutlinerFilter();
      setupChecks();
      setupPhotoshopTools();
      setupUVCycling();
      setupTextureHandling();
      setupUVFill();
      setupAltDuplicate();
      setupNameOverlap();
      setupUVOutline();
      let panel_setup_listener;
      function showCollectionPanel() {
        const local_storage_key = "hytale_plugin:collection_panel_setup";
        if (localStorage.getItem(local_storage_key)) return true;
        if (!Modes.edit) return false;
        if (Panels.collections.slot == "hidden") {
          Panels.collections.moveTo("right_bar");
        }
        if (Panels.collections.folded) {
          Panels.collections.fold();
        }
        if (panel_setup_listener) {
          panel_setup_listener.delete();
          panel_setup_listener = void 0;
        }
        localStorage.setItem(local_storage_key, "true");
        return true;
      }
      if (!showCollectionPanel()) {
        panel_setup_listener = Blockbench.on("select_mode", showCollectionPanel);
      }
      let on_finish_edit = Blockbench.on("generate_texture_template", (arg) => {
        for (let element of arg.elements) {
          if (typeof element.autouv != "number") continue;
          element.autouv = 1;
        }
      });
      track(on_finish_edit);
      let pivot_marker = new CustomPivotMarker();
      track(pivot_marker);
      let group_pivot_indicator = new GroupPivotIndicator();
      track(group_pivot_indicator);
    },
    onunload() {
      cleanup();
    }
  });
})();
