# install-diff

A command-line tool to compare installed package versions with the latest available versions.
This package will compare the package versions defined in the `package-lock.json` file with the latest installable versions as defined in the `package.json` to show what would change when running `npm ci` vs running `npm i`.

## Usage

```
Usage: install-diff [options]

Options:
  -v, --version           output the version number
  -d, --directory <path>  specify the directory to check (default: ".")
  -a, --all               show all packages, even those without changes
  -h, --help              display help for command
```

### Example

```bash
npx install-diff -d <directory>
```
