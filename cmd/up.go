/*
Copyright (c) 2017 Bitnami

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/ksonnet/kubecfg/metadata"
	"github.com/ksonnet/kubecfg/pkg/kubecfg"
	"github.com/kubeapps/installer/pkg/gke"
	"github.com/spf13/cobra"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes"
)

const (
	GcTag = "bitnami/kubeapps"
)

var upCmd = &cobra.Command{
	Use:   "up FLAG",
	Short: "Install KubeApps components.",
	Long: `Install KubeApps components.

List of components that kubeapps up installs:

- Kubeless (https://github.com/kubeless/kubeless)
- Sealed-Secrets (https://github.com/bitnami/sealed-secrets)
- Helm/Tiller (https://github.com/kubernetes/helm)
- Kubeapps Dashboard (https://github.com/kubeapps/dashboard)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		c := kubecfg.ApplyCmd{
			DefaultNamespace: "default",
		}
		var err error
		c.Create = true

		c.DryRun, err = cmd.Flags().GetBool("dry-run")
		if err != nil {
			return err
		}

		c.GcTag = GcTag

		c.ClientPool, c.Discovery, err = restClientPool()
		if err != nil {
			return err
		}

		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		wd := metadata.AbsPath(cwd)

		manifest, err := fsGetFile("/kubeapps-objs.yaml")
		if err != nil {
			return err
		}
		objs, err := parseObjects(manifest)
		if err != nil {
			return err
		}

		// k8s on GKE
		if ok, err := isGKE(c.Discovery); err != nil {
			return err
		} else if ok {
			gcloudPath, err := gke.SdkConfigPath()
			if err != nil {
				return err
			}

			user, err := gke.GetActiveUser(gcloudPath)
			if err != nil {
				return err
			}

			crb, err := gke.BuildCrbObject(user)
			if err != nil {
				return err
			}

			//(tuna): we force the deployment ordering here:
			// this clusterrolebinding will be created before others for granting the proper permission.
			// when the installation finishes, it will be gc'd immediately.
			c.SkipGc = true
			c.Run(crb, wd)
			c.SkipGc = false
		}

		err = c.Run(objs, wd)
		if err != nil {
			return err
		}

		// Generate mongodb password
		// TODO: Do not assume keys and IDs for the secret
		cfg, err := buildOutOfClusterConfig()
		if err != nil {
			return fmt.Errorf("Can not get kubernetes config: %v", err)
		}
		cli, err := kubernetes.NewForConfig(cfg)
		if err != nil {
			return fmt.Errorf("Can not get kubernetes client: %v", err)
		}
		return generateMongoDBSecret(cli, objs)
	},
}

func init() {
	RootCmd.AddCommand(upCmd)
	upCmd.Flags().Bool("dry-run", false, "Provides output to be submitted to the server.")
}

func isGKE(disco discovery.DiscoveryInterface) (bool, error) {
	sv, err := disco.ServerVersion()
	if err != nil {
		return false, err
	}
	if strings.Contains(sv.GitVersion, "gke") {
		return true, nil
	}

	return false, nil
}

func generateMongoDBSecret(cli kubernetes.Interface, objs []*unstructured.Unstructured) error {
	var mongoNS string
	for _, obj := range objs {
		if obj.GetKind() == "Deployment" && obj.GetName() == "mongodb" {
			mongoNS = obj.GetNamespace()
			break
		}
	}
	if mongoNS == "" {
		return fmt.Errorf("Unable to find the namespace of the MongoDB database")
	}
	err := populateSecretWithPasswords(cli, mongoNS, "mongodb", []string{"mongodb-password", "mongodb-root-password"})
	if err != nil {
		return err
	}
	return nil
}
