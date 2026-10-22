## Objective

A MessagePack library for JavaScript that any project already using msgpack-javascript can adopt as a drop-in replacement. Existing projects keep working without changing their own code, observe the same behavior on every input, output, option, and edge case, and, on the same machine and data, encode and decode everyday messages faster than the original, with no measured case slower.

## Success criteria

- A project that already uses msgpack-javascript can replace it with the new library without editing its own source, and continues to work.
- For the same data, the messages the new library produces are indistinguishable from the original's output.
- Every message, option, extension, and error case the original handles produces the same result with the new library.
- Existing browser applications and existing server applications both keep working after the replacement.
- On the same machine with the same data, a side-by-side comparison shows the new library encoding faster and decoding faster for messages typical of real applications, from small payloads to moderately large ones.
- In that comparison, no measured case is slower than the original for either encoding or decoding.
