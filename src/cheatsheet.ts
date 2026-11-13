/**
 * OpenSCAD quick reference, served as a resource and via the `cheatsheet`
 * tool so the model always has syntax (and this server's workflow) at hand.
 */

export const OPENSCAD_CHEATSHEET = `
# OpenSCAD Quick Reference

Units are millimetres. Z is up. Every render reports the model's Size/Bounds —
check them against what the user asked for.

## 2-D Primitives
  circle(r|d)
  square(size, center)
  polygon(points, paths)
  text(text, size, font, halign, valign)   // fonts: "Liberation Sans" (default), "DejaVu Sans:style=Bold", "DejaVu Sans Mono", "DejaVu Serif"

## 3-D Primitives
  cube(size, center)
  sphere(r|d)
  cylinder(h, r|d, r1|d1, r2|d2, center)
  polyhedron(points, faces)

## Transformations
  translate([x, y, z])   rotate([x, y, z])   // degrees
  scale([x, y, z])       mirror([x, y, z])    multmatrix(m)
  color("name"|"#rrggbb"|[r,g,b,a])          // shown in previews and kept in 3MF exports; alpha < 1 is see-through in previews (a part inside a solid is merged away: hollow the outer part to see inside)
  offset(r|delta, chamfer)   hull()   minkowski()   resize([x, y, z], auto)

## Boolean Operations
  union()   difference()   intersection()

## Extrusions
  linear_extrude(height, center, convexity, twist, slices, scale)
  rotate_extrude(angle, convexity)

## Modules & Functions
  module name(params) { ... }
  function name(params) = expr;

## Control Flow
  for (i = [start:step:end]) { ... }    for (i = list) { ... }
  if (cond) { ... } else { ... }        let (assignments) { ... }
  assert(cond, "message")               echo("label", value)   // echo output is returned with each render

## Math / Lists / Strings
  abs sign sin cos tan asin acos atan atan2 floor ceil round ln log exp pow sqrt min max norm cross
  len concat lookup search str chr ord rands(min, max, count, seed)

## Special Variables
  $fn (fragments; e.g. $fn=64 for smooth curves)   $fa   $fs   $t (animation)
  $vpr $vpt $vpd $vpf (viewport)

## Import / Use
  include <file.scad>    // inline the file
  use <file.scad>        // import modules/functions only
  import("file.stl")     // import geometry
  Relative paths resolve from the rendered file — render with \`file\` (absolute path) for multi-file projects.

## Modifiers
  %  transparent/background   #  highlight   !  show only this   *  disable

## BOSL2 (bundled, works with zero setup)
  include <BOSL2/std.scad>
  cuboid([x,y,z], rounding=2, edges="Z", anchor=BOTTOM)
  cyl(h=20, d=10, chamfer=1)              tube(h=10, od=20, id=16)
  prismoid(size1=[40,40], size2=[20,20], h=15)
  attach / position / anchor=TOP|BOTTOM|LEFT|RIGHT|FRONT|BACK — place parts relative to each other
  include <BOSL2/threading.scad>   threaded_rod(d=10, l=20, pitch=1.5)
  include <BOSL2/screws.scad>      screw("M3", length=10)   screw_hole("M3", length=10)
  Docs: https://github.com/BelfrySCAD/BOSL2/wiki

## Tips for AI-generated models
  - Put dimensions in named variables at the top; use \`params\` to try variations without editing code
  - Set $fn for smooth curves (e.g. $fn=64), lower it if renders get slow
  - Use difference() for holes; extend cutters 0.01–1 mm past faces to avoid coplanar artefacts
  - center=true makes alignment easier
  - Use render_multiview (orthographic front/right/top) to check alignment and proportions
  - For 3D printing: flat bottom on Z=0, walls ≥ 1.2 mm, avoid overhangs > 45°
`.trim();

export const SERVER_INSTRUCTIONS = `
Create 3D models by writing OpenSCAD code (units: millimetres, Z up).
Workflow: call render to preview → read the returned Size/Bounds lines and ECHO output to verify dimensions → adjust the code and render again → use render_multiview for orthographic front/right/top checks → export (stl or 3mf) when the user is happy. render_turntable makes an animation for the user.
OpenSCAD errors are returned verbatim with line numbers; fix the code and retry.
BOSL2 is bundled (include <BOSL2/std.scad>) and text() works. Call cheatsheet for syntax help.
To work on files on disk use read_scad_file / save_scad_file, and pass \`file\` instead of \`code\` so relative include/use paths resolve.
`.trim();
