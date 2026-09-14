/**
 * Overscan solid: a mesh drawn at the detail it has, then shown in blocks.
 *
 * <ov-solid> draws its mesh first into a small frame, one texel per sample
 * spacing as the model sits on screen. This pass lays that frame over the
 * element with NEAREST sampling, so a view larger than the mesh's own detail
 * shows blocks instead of smoothing. A smooth surface there would be detail
 * nobody measured.
 *
 * The dither is not drawn here. It is decided in the mesh pass, face by face,
 * from each face's confidence, in the same cells as the blocks.
 *
 * No cellular or Voronoi noise anywhere in this kit.
 */

/** @resolution */
uniform vec2 u_resolution;

/** The mesh pass: RGBA, one texel per block, alpha 0 where nothing was drawn. */
uniform sampler2D u_frame;

/** The frame's size in texels. */
uniform vec2 u_frameSize;

/** Device pixels per block. */
uniform float u_block;

void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_block);
  gl_FragColor = texture2D(u_frame, (cell + 0.5) / u_frameSize);
}
