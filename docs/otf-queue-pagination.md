# OTF Queue Pagination

The Opportunity-to-Fulfillment operator queue returns a maximum of 60 contracts per batch.

Query parameters:
- `page`: 1-based batch number
- `page_size`: maximum 60

Response metadata includes total contracts after filters, current range, total pages, and previous/next availability.

The operator interface exposes **Previous 60** and **Next 60** controls. Changing queue mode, state, or exclusion filters resets the queue to batch 1.
