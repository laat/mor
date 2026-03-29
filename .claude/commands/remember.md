Save a code snippet or piece of knowledge to the memory store.

$ARGUMENTS describes what to remember. It can be a function name, a concept, a piece of code in the current project, or general knowledge.

1. Find or compose the content to save. If it references code in the project, read it first.
2. Pick a short descriptive title and a one-line description.
3. Choose appropriate tags (1-3) and a type (`knowledge`, `snippet`, or `file`).
4. Pipe the content into `mor add`:

```
echo '<content>' | mor add -t "<title>" -d "<description>" --tags "<tags>" --type <type>
```

If $ARGUMENTS is empty, ask the user what to remember.
