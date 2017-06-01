#!/bin/bash
mor-ls --format dot | dot -Tsvg > ../doc/dependencies.svg
