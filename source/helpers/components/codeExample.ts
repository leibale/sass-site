import sass from 'sass';

import { liquidEngine } from '../engines';

/**
 * Renders a code example.
 *
 * This takes a block of SCSS and/or indented syntax code, and emits HTML that
 * (combined with JS) will allow users to choose which to display.
 *
 * The SCSS should be separated from the Sass with `===`. For example, in
 * LiquidJS:
 *
 *     {% codeExample 'unique-id-string' %}
 *     .foo {
 *       color: blue;
 *     }
 *     ===
 *     .foo
 *       color: blue
 *     {% endcodeExample %}
 *
 * Different sections can be separated within one syntax (for example, to
 * indicate different files) with `---`. For example, in LiquidJS:
 *
 *     {% codeExample 'unique-id-string' %}
 *     // _reset.scss
 *     * {margin: 0}
 *     ---
 *     // base.scss
 *     @import 'reset';
 *     ===
 *     // _reset.sass
 *     *
 *       margin: 0;
 *     ---
 *     // base.sass
 *     @import reset
 *     {% endcodeExample %}
 *
 * A third section may optionally be provided to represent compiled CSS. If it's
 * not passed and `autogenCSS` is `true`, it's generated from the SCSS source.
 * If the autogenerated CSS is empty, it's omitted entirely.
 *
 * If `syntax` is either `sass` or `scss`, the first section will be
 * interpreted as that syntax and the second will be interpreted (or
 * auto-generated) as the CSS output.
 */
export default async function codeExample(
  contents: string,
  exampleName: string,
  autogenCSS = true,
  syntax: 'sass' | 'scss' | null = null,
) {
  const code = generateCodeExample(contents, autogenCSS, syntax);
  return liquidEngine.renderFile('code_examples/code_example', {
    code,
    exampleName,
  });
}

const generateCodeExample = (
  contents: string,
  autogenCSS: boolean,
  syntax: 'sass' | 'scss' | null,
) => {
  const splitContents = contents.split('\n===\n');

  let scssContents, sassContents, cssContents;
  switch (syntax) {
    case 'scss':
      scssContents = splitContents[0];
      cssContents = splitContents[1];
      break;
    case 'sass':
      sassContents = splitContents[0];
      cssContents = splitContents[1];
      break;
    default:
      scssContents = splitContents[0];
      sassContents = splitContents[1];
      cssContents = splitContents[2];
      if (!sassContents) {
        throw new Error(`Couldn't find === in:\n${contents}`);
      }
      break;
  }

  const scssExamples =
    scssContents?.split('\n---\n').map((str) => str.trim()) ?? [];
  const sassExamples =
    sassContents?.split('\n---\n').map((str) => str.trim()) ?? [];

  if (!cssContents && autogenCSS) {
    const sections = scssContents ? scssExamples : sassExamples;
    if (sections.length !== 1) {
      throw new Error("Can't auto-generate CSS from more than one SCSS block.");
    }
    cssContents = sass.compileString(sections[0], {
      syntax: syntax === 'sass' ? 'indented' : 'scss',
    }).css;
  }

  const cssExamples =
    cssContents?.split('\n---\n').map((str) => str.trim()) ?? [];

  const { scssPaddings, sassPaddings, cssPaddings } = getPaddings(
    scssExamples,
    sassExamples,
    cssExamples,
  );

  const { canSplit, maxSourceWidth, maxCSSWidth } = getCanSplit(
    scssExamples,
    sassExamples,
    cssExamples,
  );
  let splitLocation: number | null = null;
  if (canSplit) {
    if (maxSourceWidth < 55 && maxCSSWidth < 55) {
      splitLocation = 0.5 * 100;
    } else {
      // Put the split exactly in between the two longest lines.
      splitLocation = 0.5 + ((maxSourceWidth - maxCSSWidth) / 110.0 / 2) * 100;
    }
  }

  return {
    scss: scssExamples,
    sass: sassExamples,
    css: cssExamples,
    scssPaddings,
    sassPaddings,
    cssPaddings,
    canSplit,
    splitLocation,
  };
};

/**
 * Calculate the lines of padding to add to the bottom of each section so
 * that it lines up with the same section in the other syntax.
 */
const getPaddings = (
  scssExamples: string[],
  sassExamples: string[],
  cssExamples: string[],
) => {
  const scssPaddings: number[] = [];
  const sassPaddings: number[] = [];
  const cssPaddings: number[] = [];
  const maxSections = Math.max(
    scssExamples.length,
    sassExamples.length,
    cssExamples.length,
  );
  Array.from({ length: maxSections }).forEach((_, i) => {
    const scssLines = (scssExamples[i] || '').split('\n').length;
    const sassLines = (sassExamples[i] || '').split('\n').length;
    const cssLines = (cssExamples[i] || '').split('\n').length;

    // Whether the current section is the last section for the given syntax.
    const isLastScssSection = i === scssExamples.length - 1;
    const isLastSassSection = i === sassExamples.length - 1;
    const isLastCssSection = i === cssExamples.length - 1;

    // The maximum lines for any syntax in this section, ignoring syntaxes for
    // which this is the last section.
    const maxLines = Math.max(
      isLastScssSection ? 0 : scssLines,
      isLastSassSection ? 0 : sassLines,
      isLastCssSection ? 0 : cssLines,
    );

    scssPaddings.push(
      getPadding({
        isLastSection: isLastScssSection,
        comparisonA: sassExamples.slice(i),
        comparisonB: cssExamples.slice(i),
        lines: scssLines,
        maxLines,
      }),
    );

    sassPaddings.push(
      getPadding({
        isLastSection: isLastSassSection,
        comparisonA: scssExamples.slice(i),
        comparisonB: cssExamples.slice(i),
        lines: sassLines,
        maxLines,
      }),
    );

    cssPaddings.push(
      getPadding({
        isLastSection: isLastCssSection,
        comparisonA: scssExamples.slice(i),
        comparisonB: sassExamples.slice(i),
        lines: cssLines,
        maxLines,
      }),
    );
  });

  return { scssPaddings, sassPaddings, cssPaddings };
};

/**
 * Make sure the last section has as much padding as all the rest of
 * the other syntaxes' sections.
 */
const getPadding = ({
  isLastSection,
  comparisonA,
  comparisonB,
  lines,
  maxLines,
}: {
  isLastSection: boolean;
  comparisonA: string[];
  comparisonB: string[];
  lines: number;
  maxLines: number;
}) => {
  let padding = 0;
  if (isLastSection) {
    padding = getTotalPadding(comparisonA, comparisonB) - lines - 2;
  } else if (maxLines > lines) {
    padding = maxLines - lines;
  }
  return Math.max(padding, 0);
};

/**
 * Returns the number of lines of padding that's needed to match the height of
 * the `<pre>`s generated for `sections1` and `sections2`.
 */
const getTotalPadding = (sections1: string[], sections2: string[]) => {
  sections1 ||= [];
  sections2 ||= [];
  return Array.from({
    length: Math.max(sections1.length, sections2.length),
  }).reduce((sum: number, _, i) => {
    // Add 2 lines to each additional section: 1 for the extra padding, and 1
    // for the extra margin.
    return (
      sum +
      Math.max(
        (sections1[i] || '').split('\n').length,
        (sections2[i] || '').split('\n').length,
      ) +
      2
    );
  }, 0);
};

const getCanSplit = (
  scssExamples: string[],
  sassExamples: string[],
  cssExamples: string[],
) => {
  const exampleSourceLengths = [...scssExamples, ...sassExamples].flatMap(
    (source) => source.split('\n').map((line) => line.length),
  );
  const cssSourceLengths = cssExamples.flatMap((source) =>
    source.split('\n').map((line) => line.length),
  );

  const maxSourceWidth = Math.max(...exampleSourceLengths);
  const maxCSSWidth = Math.max(...cssSourceLengths);

  const canSplit = Boolean(maxCSSWidth && maxSourceWidth + maxCSSWidth < 110);

  return {
    canSplit,
    maxSourceWidth,
    maxCSSWidth,
  };
};
