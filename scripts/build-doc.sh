#!/bin/bash
mor-ls --format dot mor-core -dt | dot -Tsvg > ../doc/dependencies.svg
