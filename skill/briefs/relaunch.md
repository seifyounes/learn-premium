# Brief: Relaunched subagent

Add this to the brief of any subagent relaunched because the one before it died mid-job. The main
agent ran `wave.ts relaunch open` first and gives you its output: each file your predecessor left,
and what the re-gate found on it.

1. **Before anything else, review every predecessor file.** Nothing your predecessor wrote counts as
   done until you've checked it: read it against your own brief and the inputs your brief names.
   The re-gate's findings are a floor, not the whole check; a file no gate covers (`covered: false`)
   is checked by you alone.
2. **Settle each file one way:**
   - **kept**: unchanged, with no re-gate finding, and right by your own reading;
   - **fixed**: you changed it, and it passes a fresh re-gate;
   - **discarded**: you deleted it (and redo its work from scratch, as a new file if you need one).
   A file with a re-gate finding can't be kept.
3. Then finish the job as your brief says, and in your report list each predecessor file with its
   outcome, so the main agent records them (`wave.ts relaunch close`).

**A relaunched Blind reader** is given only its brief, the Module's Materials, the Private folder
and its own predecessor's reading (`reading-a.json` or `reading-b.json`). Never open the other
reader's reading, the settled `reading.json`, `resolutions.json`, the crops or any dispute: the
two readings are compared only because neither reader saw the other's.
