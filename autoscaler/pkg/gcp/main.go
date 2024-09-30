package gcp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	run "cloud.google.com/go/run/apiv2"
	"cloud.google.com/go/run/apiv2/runpb"
	"cloud.google.com/go/storage"
	"github.com/hi-fi/gha-runners-on-managed-env/autoscaler/pkg/github"
	"golang.org/x/oauth2/google"
)

type Cr struct {
	ctx           context.Context
	logger        *slog.Logger
	client        *run.JobsClient
	storageClient *storage.Client
	jobName       string
	projectId     string
	location      string
}

func GetClient(ctx context.Context, logger *slog.Logger) (*Cr, error) {
	jobName, err1 := requireEnv("JOB_NAME")
	location, err2 := requireEnv("CLOUDSDK_RUN_REGION")
	project, err3 := requireEnv("GOOGLE_CLOUD_PROJECT")

	if errors.Join(err1, err2, err3) != nil {
		return nil, errors.Join(err1, err2, err3)
	}

	_, err := google.FindDefaultCredentials(ctx)

	if err != nil {
		return nil, err
	}

	client, err := run.NewJobsClient(ctx)
	if err != nil {
		return nil, err
	}

	storageClient, err := storage.NewClient(ctx)
	if err != nil {
		return nil, err
	}

	return &Cr{
		ctx:           ctx,
		logger:        logger,
		client:        client,
		storageClient: storageClient,
		jobName:       jobName,
		projectId:     project,
		location:      location,
	}, nil
}

func (c *Cr) CurrentRunnerCount() (int, error) {
	return 0, fmt.Errorf("not implemented")
}

func (c *Cr) TriggerNewRunners(runnerConfigurations []github.RunnerConfiguration) (err error) {
	var errorSlice []error

	var requestIds []int64
	for _, runnerConfiguration := range runnerConfigurations {
		requestIds = append(requestIds, runnerConfiguration.RunnerRequestId)
	}

	c.logger.Debug("Triggering new runner(s)", slog.Int("count", len(runnerConfigurations)), slog.Any("requestsIds", requestIds))

	// Cloud run doesn't support subpaths in volumes, so have to make bucket for each path needed. Meaning 4 buckets each time, where 1, 3 or 4 can be in use.
	// We don't know at this point what's going to run on container, so we have to presume for "all"
	// Mount paths in spawned container:
	//
	// For all
	// - /__w
	// For container actions:
	// - /github/workflow
	// - /github/workspace
	// - /github/file_commands
	// For Job containers
	// - /github/workflow
	// - /github/home
	// - /__e (externals, handled separately)
	//
	// N number of user mounts -> not supported at the moment
	//
	// Externals is handled separately from IaC code, no need to handle it here

	// runner requires just 2 mount paths; work and externals. Paths in job/sevice containers are mainly from work, so adding full volume would just reveal "too much" to service, which is accessible for PoC.
	// some path from share are mounted to different path in service/job container, but that should be handled with symlinks (in PoC at least)

	jobFullName := fmt.Sprintf("projects/%s/locations/%s/jobs/%s", c.projectId, c.location, c.jobName)
	getReq := &runpb.GetJobRequest{
		// Required. The full name of the Job. Format: projects/{project}/locations/{location}/jobs/{job}, where {project} can be project id or number.
		Name: jobFullName,
	}

	c.logger.Debug(fmt.Sprintf("Getting job: %s", jobFullName))
	job, err := c.client.GetJob(c.ctx, getReq)

	if err != nil {
		return err
	}

	c.logger.Debug(fmt.Sprintf("Obtained job: %s", job.Name))

	jobNameSlice := strings.Split(jobFullName, "/")
	jobParent := strings.Join(jobNameSlice[0:4], "/")

	volumes := job.Template.Template.GetVolumes()
	mountPaths := job.Template.Template.Containers[0].GetVolumeMounts()
	environmentVariables := job.Template.Template.Containers[0].GetEnv()

	for _, runnerConfiguration := range runnerConfigurations {
		var newJob *runpb.Job

		c.logger.Debug("Provding runner for request", slog.Int64("runnerRequestId", runnerConfiguration.RunnerRequestId))
		newJobName := fmt.Sprintf("%s-%d", c.jobName, runnerConfiguration.RunnerRequestId)
		// 1 dynamic bucket required for work; other static bucket is used for externals
		bucket := c.storageClient.Bucket(fmt.Sprintf("gha-runners-cloudrun-work-temp-%d", runnerConfiguration.RunnerRequestId))
		c.logger.Debug("Creating bucket", slog.String("bucket", bucket.BucketName()), slog.String("project", c.projectId))
		bucket.Create(c.ctx, c.projectId, &storage.BucketAttrs{
			StorageClass: "STANDARD",
			Location:     c.location,
			HierarchicalNamespace: &storage.HierarchicalNamespace{
				Enabled: true,
			},
			// Hierarchical namespace buckets must use uniform bucket-level access.
			UniformBucketLevelAccess: storage.UniformBucketLevelAccess{
				Enabled: true,
			},
			SoftDeletePolicy: &storage.SoftDeletePolicy{
				RetentionDuration: 0,
			},
		})

		newJob = &runpb.Job{
			Template: job.GetTemplate(),
			Labels:   job.GetLabels(),
		}

		newJob.Template.Template.Volumes = append(
			volumes,
			&runpb.Volume{
				Name: "work",
				VolumeType: &runpb.Volume_Gcs{
					Gcs: &runpb.GCSVolumeSource{
						Bucket: bucket.BucketName(),
					},
				},
			},
		)

		newJob.Template.Template.Containers[0].VolumeMounts = append([]*runpb.VolumeMount{
			{
				Name:      "work",
				MountPath: "/home/runner/_work",
			},
		},
			// https://github.com/actions/actions-runner-controller/blob/90b68fec1a364e2eb1c784e190022c601bf23ecd/charts/gha-runner-scale-set/templates/_helpers.tpl#L111C16-L111C34
			mountPaths...,
		)

		newJob.Template.Template.Containers[0].Env = append(
			environmentVariables,
			&runpb.EnvVar{
				Name:   "ACTIONS_RUNNER_INPUT_JITCONFIG",
				Values: &runpb.EnvVar_Value{Value: runnerConfiguration.JitConfig},
			},
			&runpb.EnvVar{
				Name:   "RUNNER_REQUEST_ID",
				Values: &runpb.EnvVar_Value{Value: fmt.Sprintf("%d", runnerConfiguration.RunnerRequestId)},
			},
			&runpb.EnvVar{
				Name:   "WORK_BUCKET_NAME",
				Values: &runpb.EnvVar_Value{Value: bucket.BucketName()},
			},
			&runpb.EnvVar{
				Name:   "STORAGE_NAME",
				Values: &runpb.EnvVar_Value{Value: bucket.BucketName()},
			},
		)

		createJob := &runpb.CreateJobRequest{
			Parent: jobParent,
			JobId:  newJobName,
			Job:    newJob,
		}

		c.logger.Debug(fmt.Sprintf("Creating job %s with parent %s", newJobName, jobParent))
		jobCreation, err := c.client.CreateJob(c.ctx, createJob)

		errorSlice = append(errorSlice, err)

		if err != nil {
			c.logger.Error(err.Error())
		} else {
			c.logger.Debug("Waiting for creation job to complete")
			_, err := jobCreation.Wait(c.ctx)

			if err != nil {
				c.logger.Error(err.Error())
			}

			errorSlice = append(errorSlice, err)
		}

		triggeredJobName := fmt.Sprintf("%s/jobs/%s", jobParent, newJobName)
		c.logger.Debug(fmt.Sprintf("Running job %s", triggeredJobName))
		_, err = c.client.RunJob(c.ctx, &runpb.RunJobRequest{
			Name: triggeredJobName,
		})

		if err != nil {
			c.logger.Error(err.Error())
		}

		errorSlice = append(errorSlice, err)
	}

	return errors.Join(errorSlice...)
}

func (c *Cr) NeededRunners(runnerConfigurations []github.RunnerConfiguration) (err error) {
	return fmt.Errorf("not implemented")
}

// Remote temporary task and bucket at completion
func (c *Cr) CleanRunners(requestIds []int64) (err error) {
	for _, requestId := range requestIds {
		bucketName := fmt.Sprintf("gha-runners-cloudrun-work-temp-%d", requestId)
		c.logger.Debug(fmt.Sprintf("Removing bucket %s", bucketName))
		bucket := c.storageClient.Bucket(bucketName)

		// We can't remove bucket that has any files in it through SDK, so just setting lifecycle policy to empty buckets at this point
		// Licecycle rule execution is async operation, so we don't know when it would be done. This is ensuring that if removal of files fails, data is not staying there for a long time
		bucket.Update(c.ctx, storage.BucketAttrsToUpdate{
			Lifecycle: &storage.Lifecycle{
				Rules: []storage.LifecycleRule{
					{
						Action: storage.LifecycleAction{
							Type: storage.DeleteAction,
						},
						Condition: storage.LifecycleCondition{
							AllObjects: true,
							AgeInDays:  0,
						},
					},
				},
			},
		})

		err = bucket.Delete(c.ctx)
		if err != nil {
			c.logger.Warn("Removal of bucket failed", slog.String("bucket", bucketName), slog.String("error", err.Error()))
		}

		jobName := fmt.Sprintf("projects/%s/locations/%s/jobs/%s-%d", c.projectId, c.location, c.jobName, requestId)

		c.logger.Debug(fmt.Sprintf("Removing job %s", jobName))
		_, err = c.client.DeleteJob(c.ctx,
			&runpb.DeleteJobRequest{
				Name: jobName,
			},
		)
		if err != nil {
			c.logger.Warn(err.Error())
		}
		c.logger.Debug(fmt.Sprintf("Cleanup e for request %d", requestId))

	}

	return nil
}

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf("value required for environment variable %s", key)
	}
	return
}
