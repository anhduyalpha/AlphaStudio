# UX/UI Quality Rubric

Every route and major shared component must score at least 4/5 before its phase is complete.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Workflow clarity | unclear | understandable | immediately obvious |
| Hierarchy | flat/confusing | adequate | focused and intentional |
| Route specificity | generic shell | partly customized | purpose-built |
| Component quality | inconsistent | serviceable | polished and coherent |
| Visual originality | template-like | competent | distinctive AlphaStudio identity |
| Minimalism | merely sparse | mostly disciplined | every element earns its place |
| Motion | distracting/absent | acceptable | purposeful and refined |
| Liquid effects | gimmicky | restrained | meaningful and integrated |
| Accessibility | blocked | mostly usable | keyboard, focus, contrast, motion fully considered |
| Responsiveness | broken | adapts | composition intentionally changes by viewport |
| Backend honesty | misleading | mostly accurate | every control maps to real behavior |
| Performance | janky | acceptable | smooth with graceful fallback |

A route fails review when its redesign can be reproduced by only changing:

- colors;
- CSS variables;
- typography;
- spacing;
- border radius;
- blur;
- shadows;
- gradients;
- animations;
- class names.

The JSX composition, information order, or interaction model must materially improve where the workflow requires it.
