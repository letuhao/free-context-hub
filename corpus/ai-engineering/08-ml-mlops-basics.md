# ML and MLOps Basics: Training, Evaluation, and Drift

## RAG versus fine-tuning versus prompting

When a model gives wrong or outdated facts, fine-tuning is **not** the default fix. A
knowledge or freshness problem is best addressed with **retrieval-augmented
generation**: update the index and let the model cite current sources. Fine-tuning
bakes knowledge into the weights, where it goes stale, carries no citations, and is
expensive to refresh — and it also changes the model's behavior and style. The clean
mapping is: a **knowledge/freshness gap → RAG**; a **behavior, style, or
specialized-skill need → fine-tuning**; a **quick steer → prompting**. These tools
compose, but matching the tool to the problem matters: reaching for fine-tuning to
fix a freshness issue is the wrong instrument.

## High training accuracy does not prove generalization

A model scoring well on its training data proves little on its own. High training
accuracy can be a symptom of **overfitting** — the model memorizing noise and
specifics of the training set rather than learning patterns that generalize.
Generalization must be judged on data the model did not train on. A model can look
excellent in training and fail in production precisely because it overfit.

## Never evaluate on training data

Evaluating a model on the data it was trained on (or on data that leaked into
training) gives an **optimistically biased** estimate that collapses in production.
The estimate is meaningless as a generalization measure because the model has
already seen the answers. This is why a proper **train/validation/test split**
exists: the **training** set fits the model, the **validation** set tunes
hyperparameters and selects among models, and the **test** set — kept untouched —
gives an honest estimate of generalization. The split also exists partly to detect
and avoid overfitting and data leakage.

## Data drift and concept drift

Deployed models face a changing world, and two kinds of change matter. **Data
drift** is a shift in the **input distribution** — the kind of inputs arriving
changes, even if the correct mapping has not. **Concept drift** is a change in the
**input-to-target relationship** — the right answer for a given input changes over
time. Both degrade a model that was correct at training time, and both require
monitoring and, when detected, updating or retraining.

## A deployed model is not "done"

It is wrong to assume a deployed model needs no monitoring because its accuracy was
fixed at training time. Accuracy in production is not fixed: as data and concept
drift accumulate, a model that was accurate at launch silently degrades. Production
models need ongoing **monitoring** of their inputs and outputs and periodic
**retraining**. Deployment is the start of a maintenance lifecycle, not the end of
the work.
