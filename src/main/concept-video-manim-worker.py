"""Trusted Manim host. Executed only inside the OS filesystem/network sandbox."""
import ast
import json
import math
import os
import sys
import textwrap
from pathlib import Path
import numpy as np
from manim import *
from manim.scene.scene_file_writer import SceneFileWriter

# Manim 0.21.0 uses CRF23 internally. Keep its intermediate lossless so
# the final shared CRF19 encoder controls quality rather than a double encode.
_original_open = SceneFileWriter.open_partial_movie_stream
def _open_lossless(self, file_path=None):
    _original_open(self, file_path)
    self._current_encode_job.stream.options = {'an': '1', 'crf': '0', 'preset': 'ultrafast'}
SceneFileWriter.open_partial_movie_stream = _open_lossless

job_path = Path(sys.argv[1])
job = json.loads(job_path.read_text())
directory = job_path.parent
blocked = {'open', 'exec', 'eval', 'compile', '__import__', 'globals', 'locals', 'vars', 'getattr', 'setattr', 'delattr', 'input', 'breakpoint', 'os', 'sys', 'Path', 'builtins'}

def validate(code):
    # Restrict the supported scene language; OS sandbox is the authority boundary.
    tree = ast.parse('def construct(self):\n' + textwrap.indent(code, '    '))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError('Manim scene cannot import modules.')
        if isinstance(node, ast.Name) and (node.id in blocked or node.id.startswith('__')):
            raise ValueError('Unsupported Manim name: ' + node.id)
        if isinstance(node, ast.Attribute) and node.attr.startswith('_'):
            raise ValueError('Private attributes are not supported in Manim scenes.')
    return tree

for i, item in enumerate(job['scenes']):
    duration = item['duration']
    namespace = {k: v for k, v in globals().items() if not k.startswith('_') and k not in blocked}
    namespace['duration'] = duration
    exec(compile(validate(item['code']), '<generated-manim-scene>', 'exec'), namespace)
    generated = namespace['construct']
    captions = item['captions']

    class VideoScene(Scene):
        def construct(self):
            bar = Rectangle(width=14.23, height=1.34, fill_color='#0c121c', fill_opacity=0.97, stroke_width=0).move_to([0, -3.34, 0]).set_z_index(10000)
            caption = Text('', font='PingFang TC', font_size=36, color=WHITE).set_z_index(10001)
            active = [-1]
            def update_caption(mob, dt):
                t = min(self.time, duration)
                index = next((j for j, c in enumerate(captions) if t < c['end']), len(captions)-1)
                if index != active[0]:
                    active[0] = index
                    text = Text(captions[index]['text'], font='PingFang TC', font_size=36, color=WHITE)
                    if text.width > 13:
                        text.scale_to_fit_width(13)
                    mob.become(text.move_to([0,-3.12,0])).set_z_index(10001)
            caption.add_updater(update_caption)
            self.add(bar, caption)
            generated(self)
            if self.time > duration + 0.051:
                raise ValueError('Manim animations exceed narration duration; use run_time as a fraction of duration.')
            if self.time < duration:
                self.wait(duration-self.time, frozen_frame=False)

    with tempconfig({'media_dir': str(directory / 'manim'), 'output_file': str(i), 'pixel_width':1920, 'pixel_height':1080, 'frame_rate':30, 'renderer':'cairo', 'write_to_movie':True, 'disable_caching':True, 'preview':False, 'verbosity':'ERROR', 'always_update_mobjects':True}):
        scene = VideoScene()
        scene.render()
        os.replace(scene.renderer.file_writer.movie_file_path, directory / f'{i}-raw.mp4')
